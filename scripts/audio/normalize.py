"""Level the generated sounds (public/audio) so the mix is even.

Generated files come out anywhere from about -3 LUFS (a blasting horn) to -60 LUFS (a whisper of a thunk). This
measures each one (EBU R128 loudness and true peak, ffmpeg's ebur128 filter) and applies one gain so it lands on the
target for its kind, never past -1 dBFS true peak, then trims silence at the very start of short sounds (a gap there
feels like lag). Files already within half a dB of their target are left alone, so running it again changes nothing.

    pip install imageio-ffmpeg        (a bundled ffmpeg; or have ffmpeg on PATH)
    python scripts/audio/normalize.py [--dry-run]
"""
import json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'audio')
DRY = '--dry-run' in sys.argv
try:
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = shutil.which('ffmpeg') or sys.exit('needs ffmpeg: pip install imageio-ffmpeg')

# integrated loudness targets (LUFS). Music sits under everything; the radio's own knob sets the final level.
LOOPS = {'roll-loop', 'wind-loop', 'engine-loop', 'crowd-loop', 'amb-forest', 'amb-night', 'amb-sky'}
def target(kind, name):
    if kind == 'music': return -16.0
    if kind == 'stingers': return -14.0
    if kind == 'voice': return -15.0
    if name in LOOPS: return -20.0
    if name.startswith(('ui-', 'ws-')): return -20.0
    return -15.0

def measure(path):
    r = subprocess.run([FF, '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    I = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    P = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r.stderr)
    return (float(I[-1]) if I else None), (float(P[-1]) if P else None)

report = {}
for kind in ['music', 'stingers', 'voice', 'sfx']:
    folder = os.path.join(ROOT, kind)
    if not os.path.isdir(folder): continue
    for f in sorted(os.listdir(folder)):
        if not f.endswith('.mp3'): continue
        name, path = f[:-4], os.path.join(folder, f)
        lufs, peak = measure(path)
        if lufs is None or peak is None or lufs < -70:
            print(f'  skip {kind}/{name}: no level ({lufs}, {peak})'); continue
        gain = min(target(kind, name) - lufs, -1.0 - peak)
        short = kind in ('sfx', 'stingers', 'voice') and name not in LOOPS
        report[f'{kind}/{name}'] = {'lufs': lufs, 'peak': peak, 'gain': round(gain, 1)}
        if abs(gain) < 0.5 and not short: continue
        print(f'  {kind}/{name}: {lufs:.1f} LUFS, peak {peak:.1f} -> {gain:+.1f} dB')
        if DRY: continue
        af = f'volume={gain:.2f}dB,alimiter=limit=0.89:level=false'
        if short: af = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005,' + af
        mono = kind in ('sfx', 'voice') and name not in LOOPS
        tmp = tempfile.NamedTemporaryFile(suffix='.mp3', delete=False).name
        args = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', af, '-codec:a', 'libmp3lame']
        args += ['-ac', '1', '-b:a', '96k'] if mono else ['-b:a', '128k']
        r = subprocess.run(args + [tmp], capture_output=True, text=True)
        if r.returncode == 0 and os.path.getsize(tmp) > 1000: shutil.move(tmp, path)
        else: print('    failed:', r.stderr[-300:]); os.unlink(tmp)
if DRY: print(json.dumps(report, indent=1)[:200])
print('done')
