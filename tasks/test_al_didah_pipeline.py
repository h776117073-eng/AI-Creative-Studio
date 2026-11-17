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
    def test_release_version(self): self.assertIn('al-didah-production-v2',SCRIPT.read_text(encoding='utf-8'))

if __name__=='__main__': unittest.main(verbosity=2)
