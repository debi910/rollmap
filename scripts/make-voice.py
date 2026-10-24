"""Voiceover for the demo video, made offline with Piper TTS.

  pip install piper-tts imageio-ffmpeg
  curl -L https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz | tar xz -C /tmp/piper
  python3 scripts/make-voice.py clips /tmp/piper/en-us-lessac-medium.onnx   # 1. speak scripts/narration.json
  node scripts/record-demo.mjs                                              # 2. record, logs demo/voice/cues.json
  python3 scripts/make-voice.py mix                                         # 3. lay the voice on the video -> demo/rollmap-demo.mp4
"""

import json
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg

root = Path(__file__).resolve().parent.parent
voice = root / "demo" / "voice"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()


def clips(model: str) -> None:
    voice.mkdir(parents=True, exist_ok=True)
    lines = json.loads((root / "scripts" / "narration.json").read_text())
    durations = {}
    for key, text in lines.items():
        out = voice / f"{key}.wav"
        subprocess.run(
            [sys.executable, "-m", "piper", "-m", model, "-f", str(out), "--sentence-silence", "0.25"],
            input=text.encode(),
            check=True,
            capture_output=True,
        )
        with wave.open(str(out)) as w:
            durations[key] = round(w.getnframes() / w.getframerate() * 1000)
    (voice / "durations.json").write_text(json.dumps(durations, indent=1))
    print(f"{len(durations)} clips, {sum(durations.values()) / 1000:.0f} s of speech")


def mix() -> None:
    cues = json.loads((voice / "cues.json").read_text())
    start = max(0, cues[0]["t"] - 500)  # drop the page-load frames before the title card
    args = [ffmpeg, "-y", "-loglevel", "error", "-ss", f"{start / 1000:.3f}", "-i", str(root / "demo" / "rollmap-demo.webm")]
    for c in cues:
        args += ["-i", str(voice / f"{c['id']}.wav")]
    chains = [f"[{i + 1}:a]adelay={c['t'] - start}:all=1[a{i}]" for i, c in enumerate(cues)]
    mixed = "".join(f"[a{i}]" for i in range(len(cues)))
    graph = ";".join(chains) + f";{mixed}amix=inputs={len(cues)}:normalize=0,apad[aout]"
    args += [
        "-filter_complex", graph,
        "-map", "0:v", "-map", "[aout]", "-shortest",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart",
        str(root / "demo" / "rollmap-demo.mp4"),
    ]
    subprocess.run(args, check=True)
    print("wrote", root / "demo" / "rollmap-demo.mp4")


if __name__ == "__main__":
    if sys.argv[1] == "clips":
        clips(sys.argv[2])
    else:
        mix()
