# AI Creative Studio mobile wrapper: keep WebView bridge methods reachable.
-keepclassmembers class com.aicreativestudio.mobile.MainActivity$NativeBridge { *; }
-keep class com.aicreativestudio.mobile.LocalCommandModel { *; }
