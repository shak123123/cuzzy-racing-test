# Builds ped_shak_face.jpg: a 512x512 planar face decal for the male pedestrian heads (Shak's face, used with consent).
# Source: a clean frontal portrait generated from Shak's reference photos (/home/user/workspace/shak_face/*.jpg).
# The texture spans x,y in [-0.13, 0.13] m around the head centre (HY); landmarks are remapped to the model's head:
#   hairline -> +0.072, eyes -> +0.006, mouth -> -0.055, chin -> -0.112 (piecewise-linear in y); cheek width -> +-0.078.
# Beyond the cheeks each row is extended with the colour at the face edge (sideburn / beard / skin carries round the
# side of the head under the planar projection).
import numpy as np, cv2, sys
src = sys.argv[1] if len(sys.argv) > 1 else '/home/user/workspace/shak_gen/shak_front.png'
im = cv2.imread(src).astype(np.float32)
# hair rows: replace the backdrop showing between / around the tufts with the hair colour (the texture also covers the
# front of the hair shell), and pull the grey specular sheen down a little
_bg = np.median(im[20:60, 20:60].reshape(-1, 3), 0); _hair = np.median(im[150:230, 400:700].reshape(-1, 3), 0)
_m = (np.linalg.norm(im - _bg, axis=2) < 60)[..., None]; _rows = (np.arange(im.shape[0]) < 262)[:, None, None]
im = np.where(_m & _rows, _hair, im); _lum = im.mean(2, keepdims=True); _hr = _rows & (_lum < 150)
im = np.where(_rows & ~_m, np.minimum(im, _hair + (im - _hair) * 0.55), im)
S, R = 512, 0.13
# photo landmarks (px, full resolution 1116x1409)
PY = [100, 275, 577, 877, 1129, 1400]          # hair top, hairline, eyes, mouth, chin, neck
MY = [0.13, 0.072, 0.006, -0.055, -0.112, -0.2]  # model y (m, relative to HY)
CX, HALF, MHALF = 568.0, 291.0, 0.078
v = np.arange(S); ym = R - (v + 0.5) / S * 2 * R           # row -> model y (top row = +R)
py = np.interp(-ym, [-m for m in MY], PY)                  # model y -> photo y
u = np.arange(S); xm = (u + 0.5) / S * 2 * R - R
px = CX + xm / MHALF * HALF
# per photo row: the extent of the head (not the light-grey backdrop) inside the cheek span; outside it, clamp so the
# row carries the colour just inside the head's edge outward (hair above, sideburn / beard / skin lower down)
bg = _bg; fg = np.linalg.norm(im - bg, axis=2) > 38
mx = np.zeros((S, S), np.float32); my = np.repeat(py[:, None], S, 1).astype(np.float32)
for r in range(S):
    row = fg[int(py[r])]; lo, hi = int(CX - HALF), int(CX + HALF); idx = np.nonzero(row[lo:hi])[0]
    L, Rr = (lo + idx[0] + 14, lo + idx[-1] - 14) if len(idx) > 40 else (CX - 60, CX + 60)
    if len(idx) <= 40: my[r] = max(py[r], 150)   # above the hair: reuse the hair rows
    mx[r] = np.clip(px, L, Rr)
out = cv2.remap(im, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_AREA if False else cv2.INTER_LINEAR)
# soften the streaked extension a little (blur only the clamped columns)
blur = cv2.GaussianBlur(out, (0, 0), 3)
w = np.clip((np.abs(xm) / MHALF - 0.9) / 0.15, 0, 1)[None, :, None]
out = out * (1 - w) + blur * w
# flat-lit photo -> the game lights it again: lift the mid-tones slightly so it doesn't double-darken
out = np.clip(255 * 1.04 * (out / 255) ** 0.85, 0, 255)
cv2.imwrite('ped_shak_face.jpg', out.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
# reference colours (sRGB hex) for the instance skin / hair
cheek = im[640:720, 330:400].reshape(-1, 3).mean(0); hair = im[150:230, 400:700].reshape(-1, 3); hair = np.median(hair, 0)
hx = lambda c: '0x%02x%02x%02x' % (int(c[2]), int(c[1]), int(c[0]))
print('skin', hx(cheek), 'hair', hx(hair))
