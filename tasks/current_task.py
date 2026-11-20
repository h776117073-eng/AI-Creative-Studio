"""Bootstrap the repository in the remote Colab runtime and run the rigged fight-video pipeline."""
import pathlib
import subprocess
import sys

REPO_URL = "https://github.com/h776117073-eng/AI-Creative-Studio.git"
REPO_DIR = pathlib.Path("/content/AI-Creative-Studio")

if not REPO_DIR.exists():
    subprocess.run(
        ["git", "clone", "--depth", "1", REPO_URL, str(REPO_DIR)],
        check=True,
        timeout=300,
    )
else:
    subprocess.run(
        ["git", "-C", str(REPO_DIR), "pull", "--ff-only"],
        check=True,
        timeout=180,
    )

sys.path.insert(0, str(REPO_DIR))
from tasks.rigged_fight_video_pipeline import main

if __name__ == "__main__":
    main()
