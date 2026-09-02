#!/usr/bin/env bash
set -euo pipefail
ROOT="$PWD"
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"

"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" "platforms;android-36" "build-tools;36.0.0" "platform-tools" "emulator" >/dev/null

rm -rf android-build
mkdir -p android-build/clearcut
curl -L --fail --retry 3 --retry-all-errors "https://github.com/SysAdminDoc/ClearCut/archive/ba6d118722b23386567c84bce8442a400713748b.tar.gz" -o /tmp/clearcut.tar.gz
tar -xzf /tmp/clearcut.tar.gz --strip-components=1 -C android-build/clearcut
chmod +x android-build/clearcut/gradlew

python3 tools/android/apply_clearcut_patch.py android-build/clearcut
python3 tools/android/fix_clearcut_patch.py android-build/clearcut
python3 tools/android/upgrade_vireon_ai_patch.py android-build/clearcut
python3 tools/android/enhance_vireon_product.py android-build/clearcut
python3 tools/android/apply_locale_bootstrap.py android-build/clearcut
python3 tools/android/harden_vireon_ui.py android-build/clearcut
python3 tools/android/harden_vireon_agent.py android-build/clearcut
rm -f android-build/clearcut/gradle/verification-metadata.xml
python3 tools/android/configure_ci_test_filter.py android-build/clearcut

pushd android-build/clearcut >/dev/null
./gradlew :app:testQaUnitTest --no-daemon --stacktrace -Dorg.gradle.dependency.verification=off -PciSourceAuditExclusions=true
RESULTS="app/build/test-results/testQaUnitTest"
test -d "$RESULTS"
TEST_COUNT=$(grep -Roh 'tests="[0-9][0-9]*"' "$RESULTS" | sed -E 's/[^0-9]//g' | awk '{s+=$1} END{print s+0}')
echo "Native Android tests: $TEST_COUNT"
test "$TEST_COUNT" -ge 1500
./gradlew :app:assembleDebug --no-daemon --stacktrace -Dorg.gradle.dependency.verification=off
popd >/dev/null

python3 tools/android/verify_and_prepare_apk.py android-build/clearcut android-build/AI-Creative-Studio-debug.apk
python3 tools/android/validate_product_smoke.py android-build/clearcut

# Headless emulator acceptance test.
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" "system-images;android-35;google_apis;x86_64" >/dev/null
if ! "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd | grep -q '^Name: vireon-ci$'; then
  echo "no" | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n vireon-ci -k "system-images;android-35;google_apis;x86_64" --force --device "pixel_6"
fi
export ANDROID_AVD_HOME="$HOME/.android/avd"
"$ANDROID_HOME/emulator/emulator" -avd vireon-ci -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot > /tmp/vireon-emulator.log 2>&1 &
EMU_PID=$!
cleanup() { adb emu kill >/dev/null 2>&1 || true; kill "$EMU_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
adb wait-for-device
for _ in $(seq 1 90); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" = "1" ] && break
  sleep 2
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1"
adb install -r android-build/AI-Creative-Studio-debug.apk
adb shell am force-stop com.aicreativestudio.mobile
adb shell am start -n com.aicreativestudio.mobile/.MainActivity --ez vireon_smoke true
sleep 10
adb shell uiautomator dump /sdcard/vireon-ar.xml >/dev/null
adb pull /sdcard/vireon-ar.xml android-build/vireon-ar.xml >/dev/null
python3 - <<'PY'
import re
s=open('android-build/vireon-ar.xml',encoding='utf-8').read()
required=['Vireon','الإعدادات','مساعد المونتاج الذكي','تصدير','الصوت','القص']
missing=[x for x in required if x not in s]
if missing: raise SystemExit(f'Arabic UI markers missing: {missing}')
print('Arabic UI smoke passed')
PY
adb exec-out screencap -p > android-build/vireon-ar.png
python3 - <<'PY'
import subprocess, xml.etree.ElementTree as ET, re, time
xml='android-build/vireon-ar.xml'
root=ET.parse(xml).getroot()
def find(text):
  for n in root.iter('node'):
    if text in ' '.join(n.attrib.get(k,'') for k in ('text','content-desc','resource-id')):
      v=[int(x) for x in re.findall(r'\d+',n.attrib.get('bounds',''))]
      if len(v)==4:return (v[0]+v[2])//2,(v[1]+v[3])//2
pt=find('الإعدادات')
if not pt: raise SystemExit('Arabic settings control missing')
subprocess.run(['adb','shell','input','tap',str(pt[0]),str(pt[1])],check=True)
time.sleep(1)
subprocess.run(['adb','shell','uiautomator','dump','/sdcard/settings.xml'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['adb','pull','/sdcard/settings.xml','android-build/settings.xml'],check=True,stdout=subprocess.DEVNULL)
r=ET.parse('android-build/settings.xml').getroot()
for n in r.iter('node'):
  if n.attrib.get('text')=='English':
    v=[int(x) for x in re.findall(r'\d+',n.attrib.get('bounds',''))]
    if len(v)==4:
      subprocess.run(['adb','shell','input','tap',str((v[0]+v[2])//2),str((v[1]+v[3])//2)],check=True);break
else: raise SystemExit('English selector missing')
time.sleep(4)
subprocess.run(['adb','shell','uiautomator','dump','/sdcard/en.xml'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['adb','pull','/sdcard/en.xml','android-build/en.xml'],check=True,stdout=subprocess.DEVNULL)
s=open('android-build/en.xml',encoding='utf-8').read()
required=['Vireon','Settings','AI Editing Assistant','Export','Audio','Cut']
missing=[x for x in required if x not in s]
if missing: raise SystemExit(f'English UI markers missing: {missing}')
for x in ('الإعدادات','مساعد المونتاج الذكي','الصوت','القص','تصدير'):
  if x in s: raise SystemExit(f'Arabic leakage after English switch: {x}')
print('English UI smoke passed')
PY
adb exec-out screencap -p > android-build/vireon-en.png

touch android-build/FINAL_VALIDATION_PASS
