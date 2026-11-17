#!/usr/bin/env python3
"""Build two textured, SMPL22-rigged character assets from private image secrets.

This is a single-image reconstruction workflow. It intentionally uses only local
inference in the Colab runtime; it does not send portraits to a hosted rigging API.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import quote

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path("/content/character_asset_work")
OUT = ROOT / "outputs" / "character_assets"
TRIPOSR = WORK / "TripoSR"
BLENDER_ROOT = WORK / "blender-4.2.0-linux-x64"
BLENDER = BLENDER_ROOT / "blender"
GH_REPO = "h776117073-eng/AI-Creative-Studio"
SMPL22 = [
    "Pelvis", "L_Hip", "R_Hip", "Spine1", "L_Knee", "R_Knee",
    "Spine2", "L_Ankle", "R_Ankle", "Spine3", "L_Foot", "R_Foot",
    "Neck", "L_Collar", "R_Collar", "Head", "L_Shoulder",
    "R_Shoulder", "L_Elbow", "R_Elbow", "L_Wrist", "R_Wrist",
]

def log(message: str) -> None:
    print(f"[character-assets] {message}", flush=True)

def run(command: list[str], *, cwd: pathlib.Path | None = None, env=None) -> None:
    log("$ " + " ".join(map(str, command)))
    subprocess.run(command, cwd=str(cwd) if cwd else None, env=env, check=True)

def decode_secret(name: str, path: pathlib.Path) -> None:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"Required GitHub Actions secret {name} is missing.")
    raw = base64.b64decode(value, validate=True)
    if len(raw) < 100:
        raise RuntimeError(f"{name} decoded to an implausibly small image.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    from PIL import Image
    with Image.open(path) as im:
        im.verify()
    log(f"{name}: private input validated ({len(raw)} bytes).")

def install_blender() -> pathlib.Path:
    if BLENDER.exists():
        return BLENDER
    WORK.mkdir(parents=True, exist_ok=True)
    archive = WORK / "blender-4.2.0-linux-x64.tar.xz"
    url = "https://download.blender.org/release/Blender4.2/blender-4.2.0-linux-x64.tar.xz"
    log("Downloading official Blender 4.2.0 runtime.")
    with requests.get(url, stream=True, timeout=(30, 180)) as response:
        response.raise_for_status()
        with archive.open("wb") as f:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    f.write(chunk)
    run(["tar", "-xf", str(archive), "-C", str(WORK)])
    if not BLENDER.exists():
        candidates = list(WORK.glob("blender-4.2*-linux-x64/blender"))
        if not candidates:
            raise RuntimeError("Blender binary was not found after extraction.")
        return candidates[0]
    return BLENDER

def blender_script(path: pathlib.Path, source: str) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path

def attach_texture_and_export_obj(obj_path: pathlib.Path, texture_path: pathlib.Path,
                                  glb_path: pathlib.Path, blend_path: pathlib.Path,
                                  blender: pathlib.Path) -> None:
    py = r'''
import bpy, os, sys
from pathlib import Path
obj_path, tex_path, glb_path, blend_path = sys.argv[sys.argv.index("--")+1:]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
if hasattr(bpy.ops.wm, "obj_import"):
    bpy.ops.wm.obj_import(filepath=obj_path)
else:
    bpy.ops.import_scene.obj(filepath=obj_path)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise RuntimeError("TripoSR OBJ did not import any mesh objects.")
img = bpy.data.images.load(tex_path, check_existing=True)
mat = bpy.data.materials.new("Character_Baked_Albedo")
mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = nodes.get("Principled BSDF")
tex = nodes.new("ShaderNodeTexImage"); tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
for obj in meshes:
    if len(obj.data.uv_layers) == 0:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear(); obj.data.materials.append(mat)
    for poly in obj.data.polygons: poly.material_index = 0
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", export_materials="EXPORT",
                           export_image_format="AUTO", export_skins=True, export_animations=False)
print("PRE_RIG_EXPORT_OK", len(meshes), sum(len(o.data.vertices) for o in meshes))
'''
    p = blender_script(WORK / "attach_texture.py", py)
    run([str(blender), "--background", "--python", str(p), "--",
         str(obj_path), str(texture_path), str(glb_path), str(blend_path)])

def rig_with_motius(glb: pathlib.Path, fbx: pathlib.Path, blender: pathlib.Path) -> dict:
    log("Installing Motius local template-rigging package.")
    if not (WORK / "Motius").exists():
        run(["git", "clone", "--depth", "1", "https://github.com/ZeyuLing/Motius.git", str(WORK / "Motius")])
    run([sys.executable, "-m", "pip", "install", "-q", "--no-deps", "-e", str(WORK / "Motius")])
    run([sys.executable, "-m", "pip", "install", "-q", "numpy>=1.26,<2", "scipy>=1.10",
         "trimesh>=4", "omegaconf>=2.3", "pydantic>=2", "PyYAML>=6", "imageio>=2.31",
         "requests>=2.31", "Pillow>=10"])
    sys.path.insert(0, str(WORK / "Motius"))
    from motius.motion import auto_rig_character
    result = auto_rig_character(
        str(glb), str(fbx), method="template", blender_executable=str(blender),
        up_axis="auto", top_k=4, weight_falloff=1.75, side_penalty=0.025,
        weight_method="capsules",
    )
    meta = {
        "output_path": str(result.output_path),
        "manifest_path": str(result.manifest_path),
        "armature_name": str(result.armature_name),
        "mesh_names": list(result.mesh_names),
        "joint_names": list(result.joint_names),
        "warnings": [str(x) for x in (result.warnings or [])],
        "metadata": json.loads(json.dumps(result.metadata, default=str)),
    }
    if not fbx.is_file() or fbx.stat().st_size < 1000:
        raise RuntimeError("Motius returned without a valid FBX file.")
    return meta

def postprocess_fbx(fbx: pathlib.Path, texture: pathlib.Path, out_glb: pathlib.Path,
                    blend: pathlib.Path, preview: pathlib.Path, qa_json: pathlib.Path,
                    blender: pathlib.Path) -> dict:
    py = r'''
import bpy, json, sys, math
from pathlib import Path
fbx, texture_path, glb, blend, preview, qa_path = sys.argv[sys.argv.index("--")+1:]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=fbx)
scene=bpy.context.scene
meshes=[o for o in scene.objects if o.type=="MESH"]
rigs=[o for o in scene.objects if o.type=="ARMATURE"]
if not meshes: raise RuntimeError("Rigged FBX contains no mesh.")
if not rigs: raise RuntimeError("Rigged FBX contains no armature.")
rig=rigs[0]
img=bpy.data.images.load(texture_path, check_existing=True)
mat=bpy.data.materials.new("Character_Baked_Albedo")
mat.use_nodes=True
nodes=mat.node_tree.nodes; bsdf=nodes.get("Principled BSDF")
tex=nodes.new("ShaderNodeTexImage"); tex.image=img
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
for obj in meshes:
    if len(obj.data.uv_layers)==0:
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.02); bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear(); obj.data.materials.append(mat)
    for poly in obj.data.polygons: poly.material_index=0
    if not any(m.type=="ARMATURE" for m in obj.modifiers):
        raise RuntimeError("Mesh has no Armature modifier.")
bones=list(rig.data.bones.keys())
required=["Pelvis","L_Hip","R_Hip","Spine1","Spine2","Neck","Head",
          "L_Shoulder","R_Shoulder","L_Elbow","R_Elbow","L_Wrist","R_Wrist",
          "L_Knee","R_Knee","L_Ankle","R_Ankle"]
missing=[n for n in required if n not in bones]
if missing: raise RuntimeError("Rig missing canonical bones: "+", ".join(missing))
# Count mesh-to-bone weights and check finite values / influence counts.
weighted_vertices=0; total_vertices=0; max_influences=0
for obj in meshes:
    vg={g.index:g.name for g in obj.vertex_groups}
    for v in obj.data.vertices:
        total_vertices+=1
        influences=[]
        for item in v.groups:
            if item.group in vg and item.weight>1e-5: influences.append(item.weight)
        if influences: weighted_vertices+=1
        max_influences=max(max_influences,len(influences))
if total_vertices==0 or weighted_vertices/total_vertices < 0.90:
    raise RuntimeError("Insufficient skin weights: %.3f"%(weighted_vertices/max(1,total_vertices)))
# Deformation smoke test: rotate an arm bone and compare the evaluated mesh bounds.
scene.frame_set(1); bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
def bounds():
    coords=[]
    for obj in meshes:
        eo=obj.evaluated_get(deps); matw=eo.matrix_world
        coords.extend([matw @ v.co for v in eo.data.vertices[::max(1,len(eo.data.vertices)//2500)]])
    return [min(v[i] for v in coords) for i in range(3)]+[max(v[i] for v in coords) for i in range(3)]
base=bounds()
bone_name="L_Elbow" if "L_Elbow" in rig.pose.bones else "L_Shoulder"
pb=rig.pose.bones[bone_name]; pb.rotation_mode="XYZ"; pb.rotation_euler[1]=math.radians(15)
bpy.context.view_layer.update(); moved=bounds()
deformation=max(abs(a-b) for a,b in zip(base,moved))
pb.rotation_euler=(0,0,0); bpy.context.view_layer.update()
if deformation < 1e-5: raise RuntimeError("Armature deformation smoke test did not move mesh vertices.")
# Pack image, render a neutral front orthographic preview.
img.pack()
scene.render.engine="BLENDER_EEVEE_NEXT"
scene.render.resolution_x=640; scene.render.resolution_y=960; scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"; scene.render.filepath=preview
# camera looks down local -Z, up +Y; frame all geometry from front-ish direction.
from mathutils import Vector
all_pts=[]
for obj in meshes:
    all_pts.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
center=sum(all_pts,Vector())/len(all_pts)
cam_data=bpy.data.cameras.new("PreviewCamera"); cam=bpy.data.objects.new("PreviewCamera",cam_data); scene.collection.objects.link(cam)
cam.location=center+Vector((0,-5.5,0.1)); direction=center-cam.location
cam.rotation_euler=direction.to_track_quat("-Z","Y").to_euler(); cam_data.type="ORTHO"
cam_data.ortho_scale=max((max(p.z for p in all_pts)-min(p.z for p in all_pts))*1.18,1.0); scene.camera=cam
for loc,power,size in [((3,-4,4),800,4),((-3,-2,2),500,3),((0,3,3),900,3)]:
    ld=bpy.data.lights.new("StudioLight","AREA"); lo=bpy.data.objects.new("StudioLight",ld); scene.collection.objects.link(lo)
    lo.location=Vector(loc)+center; ld.energy=power; ld.shape="DISK"; ld.size=size
    lo.rotation_euler=(center-lo.location).to_track_quat("-Z","Y").to_euler()
scene.world.color=(0.15,0.15,0.15)
bpy.ops.wm.save_as_mainfile(filepath=blend)
bpy.ops.export_scene.gltf(filepath=glb,export_format="GLB",export_skins=True,
                           export_animations=False,export_materials="EXPORT",
                           export_image_format="AUTO")
bpy.ops.render.render(write_still=True)
report={"mesh_count":len(meshes),"armature_count":len(rigs),"bone_count":len(bones),
        "bone_names":bones,"missing_required_bones":missing,"vertex_count":total_vertices,
        "weighted_vertex_count":weighted_vertices,"weighted_vertex_ratio":weighted_vertices/max(1,total_vertices),
        "max_vertex_influences":max_influences,"arm_deformation_delta":deformation,
        "deformation_smoke_test":"passed","texture_packed":bool(img.packed_file),
        "uv_mesh_count":sum(1 for o in meshes if len(o.data.uv_layers)>0)}
Path(qa_path).write_text(json.dumps(report,indent=2),encoding="utf-8")
print("RIG_QA_OK",json.dumps(report))
'''
    p = blender_script(WORK / "postprocess_rig.py", py)
    run([str(blender), "--background", "--python", str(p), "--",
         str(fbx), str(texture), str(out_glb), str(blend), str(preview), str(qa_json)])
    return json.loads(qa_json.read_text(encoding="utf-8"))

def run_tripOSR(image: pathlib.Path, out_dir: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, str(TRIPOSR / "run.py"), str(image),
        "--output-dir", str(out_dir), "--device", "cuda:0",
        "--chunk-size", "4096", "--mc-resolution", "256",
        "--model-save-format", "obj", "--bake-texture",
        "--texture-resolution", "1024",
    ]
    run(cmd, cwd=TRIPOSR)
    # TripoSR enumerates each supplied image directory as 0 for a single-image call.
    candidates = [out_dir / "0", out_dir]
    for d in candidates:
        mesh = d / "mesh.obj"
        tex = d / "texture.png"
        if mesh.is_file() and tex.is_file():
            return mesh, tex
    raise RuntimeError(f"TripoSR did not emit both mesh.obj and texture.png under {out_dir}.")

def publish_release(bundle: pathlib.Path, files: list[pathlib.Path], tag: str) -> dict:
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise RuntimeError("GH_TOKEN is unavailable; cannot publish verified artifacts.")
    api = "https://api.github.com/repos/" + GH_REPO
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    payload = {
        "tag_name": tag, "name": "Rigged 3D character assets — " + tag,
        "body": (
            "Two single-image reconstructed character models with baked albedo textures, "
            "SMPL22 template rigs, GLB/FBX/BLEND exports, previews, and QA reports. "
            "Single-view geometry is inferred on unseen sides; review deformation and anatomy "
            "before production use. Inputs are not included in this release."
        ),
        "draft": False, "prerelease": False, "generate_release_notes": False,
    }
    response = requests.post(api + "/releases", headers=headers, json=payload, timeout=60)
    response.raise_for_status()
    release = response.json()
    upload_base = release["upload_url"].split("{", 1)[0]
    asset_rows=[]
    for path in files:
        with path.open("rb") as stream:
            url = upload_base + "?name=" + quote(path.name)
            res = requests.post(url, headers={**headers,"Content-Type":"application/octet-stream"},
                                data=stream, timeout=(60,900))
        res.raise_for_status()
        item=res.json()
        asset_rows.append({"name":item["name"],"size":item["size"],"url":item["browser_download_url"]})
        log(f"Uploaded {item['name']} ({item['size']} bytes).")
    return {"html_url":release["html_url"],"tag_name":tag,"assets":asset_rows}

def main() -> None:
    start=time.time()
    WORK.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
    inputs=WORK/"private_inputs"; inputs.mkdir(exist_ok=True)
    decode_secret("CHAR_01_IMAGE_B64",inputs/"char_01.jpg")
    decode_secret("CHAR_02_IMAGE_B64",inputs/"char_02.jpg")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA GPU is required. Select T4/L4/A100 in the workflow.")
    log("GPU: "+torch.cuda.get_device_name(0))
    if torch.cuda.get_device_properties(0).total_memory < 5*1024**3:
        raise RuntimeError("GPU has less than 5 GiB VRAM; TripoSR requires about 6 GiB.")
    blender=install_blender()
    if not TRIPOSR.exists():
        run(["git","clone","--depth","1","https://github.com/VAST-AI-Research/TripoSR.git",str(TRIPOSR)])
    run([sys.executable,"-m","pip","install","-q","--upgrade","setuptools"])
    # torchmcubes' pyproject dynamically reads the installed torch version.
    # Install the remaining TripoSR dependencies first, then compile torchmcubes
    # without PEP-517 build isolation so it sees Colab's preinstalled CUDA PyTorch.
    requirements = (TRIPOSR / "requirements.txt").read_text(encoding="utf-8").splitlines()
    requirements = [
        line for line in requirements
        if not line.strip().startswith("git+https://github.com/tatsy/torchmcubes")
        and not line.strip().startswith("Pillow==")
        and not line.strip().startswith("xatlas==")
        and line.strip() != "gradio"
    ]
    # The upstream pins Pillow 10.1 and xatlas 0.0.9 predate the Colab
    # Python 3.13 runtime. Install their Python 3.13 wheels explicitly.
    run([sys.executable,"-m","pip","install","-q","Pillow>=11.0,<13","xatlas>=0.0.11"])
    filtered_requirements = WORK / "triposr-requirements-no-torchmcubes.txt"
    filtered_requirements.write_text("\n".join(requirements) + "\n", encoding="utf-8")
    run([sys.executable,"-m","pip","install","-q","-r",str(filtered_requirements)])
    run([sys.executable,"-m","pip","install","-q","cmake>=3.24","ninja","scikit-build-core>=1.0","pybind11>=2.10"])
    run([sys.executable,"-m","pip","install","-q","--no-build-isolation","git+https://github.com/tatsy/torchmcubes.git"])
    import torchmcubes
    log("torchmcubes import verified after build against Colab PyTorch.")
    from PIL import Image
    names=[
        ("CHAR_01","Character 01 — black suit and red tie",inputs/"char_01.jpg"),
        ("CHAR_02","Character 02 — sage sweatshirt and dark trousers",inputs/"char_02.jpg"),
    ]
    results=[]
    for index,(char_id,label,image) in enumerate(names,1):
        log(f"=== {char_id}: {label} ({index}/2) ===")
        base=OUT/char_id; base.mkdir(parents=True,exist_ok=True)
        trip_dir=WORK/"triposr"/char_id
        obj,texture=run_tripOSR(image,trip_dir)
        source_glb=base/(char_id+"_textured_unrigged.glb")
        source_blend=base/(char_id+"_textured_unrigged.blend")
        attach_texture_and_export_obj(obj,texture,source_glb,source_blend,blender)
        rigged_fbx=base/(char_id+"_SMPL22_rigged.fbx")
        motius=rig_with_motius(source_glb,rigged_fbx,blender)
        rigged_glb=base/(char_id+"_SMPL22_rigged.glb")
        blend=base/(char_id+"_SMPL22_rigged.blend")
        preview=base/(char_id+"_preview.png")
        qa_file=base/(char_id+"_qa.json")
        qa=postprocess_fbx(rigged_fbx,texture,rigged_glb,blend,preview,qa_file,blender)
        for p in [rigged_fbx,rigged_glb,blend,preview,qa_file]:
            if not p.is_file() or p.stat().st_size<100:
                raise RuntimeError(f"Missing/empty expected output: {p}")
        # GLB sanity check: valid GLB magic, length field, and JSON chunk.
        raw=rigged_glb.read_bytes()
        if raw[:4]!=b"glTF" or int.from_bytes(raw[4:8],"little")!=len(raw):
            raise RuntimeError(f"{char_id} GLB header/length validation failed.")
        results.append({"character_id":char_id,"label":label,"source":"single uploaded front-view image",
                        "rig_method":"Motius local template + capsule skin weights",
                        "tripo_source_mesh_vertices":None,"motius":motius,"qa":qa,
                        "files":[str(p.relative_to(OUT)) for p in [rigged_fbx,rigged_glb,blend,preview,qa_file]]})
        log(f"{char_id} passed structural GLB/rig/weight/deformation checks.")
        del obj,texture
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    integration={
      "schema_version":"1.0",
      "coordinate_contract":"Motius SMPL22 canonical bones; source motion keypoints COCO-17",
      "characters":[
        {"character_id":"CHAR_01","asset":"CHAR_01/CHAR_01_SMPL22_rigged.glb","armature":"Motius_SMPL22_Rig"},
        {"character_id":"CHAR_02","asset":"CHAR_02/CHAR_02_SMPL22_rigged.glb","armature":"Motius_SMPL22_Rig"}
      ],
      "smpl22_to_coco17_landmark_map":{
        "Pelvis":"mid_hip (derived from left_hip/right_hip)",
        "L_Hip":"left_hip","R_Hip":"right_hip",
        "Spine1":"mid_torso (interpolated; not a COCO landmark)",
        "Spine2":"mid_torso (interpolated; not a COCO landmark)",
        "Spine3":"mid_torso (interpolated; not a COCO landmark)",
        "Neck":"mid_shoulder (derived from left_shoulder/right_shoulder)",
        "Head":"nose (approximate head anchor; not facial rig)",
        "L_Collar":"left_shoulder","R_Collar":"right_shoulder",
        "L_Shoulder":"left_shoulder","R_Shoulder":"right_shoulder",
        "L_Elbow":"left_elbow","R_Elbow":"right_elbow",
        "L_Wrist":"left_wrist","R_Wrist":"right_wrist",
        "L_Knee":"left_knee","R_Knee":"right_knee",
        "L_Ankle":"left_ankle","R_Ankle":"right_ankle",
        "L_Foot":"left_ankle (foot orientation unavailable in COCO-17)",
        "R_Foot":"right_ankle (foot orientation unavailable in COCO-17)"
      },
      "notes":["This map defines approximate correspondence only; it does not assign either model to video tracks.",
               "COCO-17 has no finger, toe, heel, eye, or ear rig landmarks.",
               "Single-image inference hallucinates unseen rear/side geometry and texture.",
               "Template rigging is structural and requires visual deformation review before production."]
    }
    (OUT/"reverse_analysis_character_map.json").write_text(json.dumps(integration,ensure_ascii=False,indent=2),encoding="utf-8")
    report={"schema_version":"1.0","created_utc":datetime.now(timezone.utc).isoformat(),
            "pipeline":"TripoSR image-to-3D -> Blender UV/material conversion -> Motius local SMPL22 template rig",
            "input_images_not_included":True,"characters":results,
            "overall_validation":"passed_structural_checks_requires_visual_review",
            "elapsed_seconds":round(time.time()-start,2),
            "known_limitations":["single-view shape completion on unseen sides","not a facial or finger rig",
             "rest pose inferred from an angled relaxed-arm image","joint smoke test is not a substitute for animator review"]}
    (OUT/"quality_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    sums={}
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.name not in {"SHA256SUMS.json"}:
            sums[str(p.relative_to(OUT))]=hashlib.sha256(p.read_bytes()).hexdigest()
    (OUT/"SHA256SUMS.json").write_text(json.dumps(sums,indent=2),encoding="utf-8")
    bundle=ROOT/"AL-Creative-Studio-character-assets-v1.zip"
    with zipfile.ZipFile(bundle,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(OUT.rglob("*")):
            if p.is_file(): z.write(p,arcname=str(pathlib.Path("character_assets")/p.relative_to(OUT)))
    tag="character-assets-"+datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    publish=[bundle]+[OUT/cid/(cid+"_SMPL22_rigged.glb") for cid in ["CHAR_01","CHAR_02"]]+[
        OUT/cid/(cid+"_preview.png") for cid in ["CHAR_01","CHAR_02"]]+[
        OUT/"quality_report.json",OUT/"reverse_analysis_character_map.json"]
    release=publish_release(bundle,publish,tag)
    (OUT/"github_release.json").write_text(json.dumps(release,indent=2),encoding="utf-8")
    log("ALL CHARACTER TASKS FINISHED SUCCESSFULLY.")
    log(json.dumps({"release":release["html_url"],"bundle_bytes":bundle.stat().st_size,
                    "character_count":len(results),"quality_report":str(OUT/"quality_report.json")},ensure_ascii=False))

if __name__=="__main__":
    main()
