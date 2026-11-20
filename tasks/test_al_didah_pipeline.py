import ast
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'tasks'/'al_didah_pipeline.py'

class StaticTests(unittest.TestCase):
    def test_syntax(self): ast.parse(SCRIPT.read_text(encoding='utf-8'))
    def test_all_frames_and_tracking(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('fi+=1',s)
        self.assertIn('linear_sum_assignment',s)
        self.assertIn('MAX_GAP=12',s)
        self.assertNotIn('detection_index',s)
    def test_gap_guard(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('0<ix-old["frame"]<=2',s)
    def test_velocity_axes_are_saved(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('"vx":vx,"vy":vy',s)
        self.assertIn('old.get("vx") is not None and old.get("vy") is not None',s)
    def test_motion_rows_are_streamed(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('motion_writer.writerows(motion_chunk)',s)
        self.assertIn('analysis_progress.json',s)
        self.assertNotIn('motion=[]',s)
        self.assertNotIn('pd.DataFrame(motion)',s)
    def test_streamed_pose_compression(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('pose_gz.write',s)
        self.assertIn('pose_gz.flush(); pose_gz.close()',s)
        self.assertIn('del model',s)
    def test_memory_bounded_tracking_and_overlay(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('stale_keys=[key for key in last.keys() if key[0] not in live_ids]',s)
        self.assertIn('pose_overlay_preview_6fps.mp4',s)
        self.assertIn('overlay_stride',s)
        self.assertIn('RSS_peak_MB',s)
    def test_publish_stages_are_instrumented(self):
        s=SCRIPT.read_text(encoding='utf-8')
        for marker in ['Publish stage 1/5','Publish stage 2/5','Publish stage 3/5','Publish stage 4/5','Publish stage 5/5']:
            self.assertIn(marker,s)
        main=s[s.index('def main():'): ]
        self.assertNotIn('contact()',main)
        self.assertIn('compresslevel=1',s)
    def test_track_candidates_do_not_claim_identity(self):
        s=SCRIPT.read_text(encoding='utf-8')
        self.assertIn('track_quality_candidates.csv',s)
        self.assertIn('manual_identity_review_required',s)
        self.assertIn('automatic_character_assignment',s)
        self.assertIn('"automatic_assignment":False',s)
        self.assertIn('candidate_for_manual_review',s)
    def test_embedded_blender_script_compiles(self):
        pipeline=ROOT/'tasks'/'rigged_fight_video_pipeline.py'
        source=pipeline.read_text(encoding='utf-8')
        marker="BLENDER_SCRIPT=r'''"
        self.assertIn(marker,source)
        start=source.index(marker)+len(marker)
        end=source.index("\n'''",start)
        blender_source=source[start:end]
        compile(blender_source,'render_rigged_fight.py','exec')
        self.assertNotIn(r"for obj in imported:\n",blender_source)
        self.assertNotIn('root.location +=',blender_source)
        self.assertIn('1.0-float(xy[1])/height',blender_source)
        self.assertIn('if scene.world is None:',blender_source)
        self.assertNotIn('scene.world.color=',blender_source.split('if scene.world is None:',1)[0])

    def test_release_version(self): self.assertIn('al-didah-production-v2',SCRIPT.read_text(encoding='utf-8'))

if __name__=='__main__': unittest.main(verbosity=2)
