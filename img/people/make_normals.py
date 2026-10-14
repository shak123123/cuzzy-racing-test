# Builds the tileable pedestrian normal maps: cloth folds (ped_cloth_n.png) and hair strands (ped_hair_n.png).
import numpy as np
from PIL import Image
N = 256
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:N, 0:N] / N
def tile_noise(freq, amp):
    h = np.zeros((N, N))
    for fx in range(1, freq + 1):
        for fy in range(1, freq + 1):
            ph = rng.random() * 6.283; a = amp / (fx * fx + fy * fy) ** 0.6
            h += a * np.sin(2 * np.pi * (fx * xx * rng.choice([-1, 1]) + fy * yy) + ph)
    return h
def to_normal(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-gx, gy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))
# cloth: soft vertical drape creases (varying width), a few diagonal pulls, fine weave
h = np.zeros((N, N))
for k in range(9):
    cx = rng.random(); w = 0.02 + rng.random() * 0.05; amp = 0.6 + rng.random()
    d = (xx - cx + 0.5) % 1 - 0.5 + 0.03 * np.sin(2 * np.pi * (yy * 2 + rng.random()))
    h -= amp * np.exp(-(d / w) ** 2) * (0.6 + 0.4 * np.sin(2 * np.pi * (yy + rng.random())))
for k in range(4):
    cx = rng.random(); w = 0.03; d = (xx + yy * rng.choice([-1, 1]) - cx + 0.5) % 1 - 0.5
    h -= 0.4 * np.exp(-(d / w) ** 2)
h += tile_noise(6, 0.25)
h += 0.02 * np.sin(2 * np.pi * xx * 64) * np.sin(2 * np.pi * yy * 64)
to_normal(h, 6.0).save('ped_cloth_n.png')
# hair: strands along v, clumped
h = np.zeros((N, N))
for fx in [8, 16, 32, 48, 64]:
    for _ in range(3):
        h += (1 / fx ** 0.5) * np.sin(2 * np.pi * (fx * xx + 0.5 * np.sin(2 * np.pi * (yy + rng.random()))) + rng.random() * 6.283)
h += 0.3 * rng.standard_normal((N, N)) * 0.2
to_normal(h, 5.0).save('ped_hair_n.png')
print('ok')
