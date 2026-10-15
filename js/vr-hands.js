// p55 real VR hands: the WebXR Input Profiles "generic-hand" rigged meshes (MIT, real/hands/LICENSE-webxr-input-profiles.txt),
// 25 bones named exactly like the WebXR hand joints, re-shaded as skin matching the main character:
//  - skin PBR (MeshPhysical: sheen, subsurface-ish warm tint, clearcoat-free), knuckle / crease darkening + fine pore noise baked
//    into vertex colours from the joint positions, glossy nails on every fingertip, a blazer sleeve cuff at the wrist
//  - Quest hand tracking: direct per-joint articulation from XRHand joints (25 per hand)
//  - controllers: grip / point / pinch / thumbs-up / wheel-wrap poses blended from trigger, grip and thumb-touch values (FK on the joint chain)
import * as THREE from 'three';
import { GLTFLoader } from './lib/addons/loaders/GLTFLoader.js';
import { clone as skClone } from './lib/addons/utils/SkeletonUtils.js';
export const SKIN = 0x9c6446, SLEEVE = 0xcdbf9f; // Shak's skin tone / blazer
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const CH = { thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'] };
for (const f of FINGERS.slice(1)) CH[f] = [f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip'];
const bufs = {}; const load = side => bufs[side] || (bufs[side] = new Promise((res, rej) => new GLTFLoader().load(new URL('../real/hands/' + side + '.glb', import.meta.url).href, res, undefined, rej)));
let skinMat = null, nailMat = null, cuffMat = null;
function mats() { if (skinMat) return; skinMat = new THREE.MeshPhysicalMaterial({ color: SKIN, vertexColors: true, roughness: 0.58, metalness: 0, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.85, 0.5, 0.38), specularIntensity: 0.45 });
  nailMat = new THREE.MeshPhysicalMaterial({ color: 0xd9a99a, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  cuffMat = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.88 }); }
export class RealHand {
  constructor(side) { this.side = side; this.g = new THREE.Group(); this.g.name = 'realHand_' + side; this.ok = false; mats();
    load(side).then(gl => { const root = skClone(gl.scene); /* every hand gets its own skeleton */ this.root = root; const B = this.B = {}; root.traverse(o => { if (o.isBone || CH.thumb.includes(o.name) || /finger|wrist/.test(o.name)) B[o.name] = o; if (o.isSkinnedMesh) this.mesh = o; });
      if (!this.mesh || !B.wrist) return; this.rest = {}; for (const k in B) this.rest[k] = { p: B[k].position.clone(), q: B[k].quaternion.clone() };
      this.bake(); this.mesh.material = skinMat; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      // nails on the distal phalanges (dorsal side = +Y in the joint frame)
      for (const f of FINGERS) { const d = B[CH[f][CH[f].length - 2]], tip = B[CH[f][CH[f].length - 1]]; if (!d || !tip) continue; const L = this.rest[tip.name].p.distanceTo(this.rest[d.name].p) || 0.02;
        const n = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), nailMat); const w = f === 'thumb' ? 0.0078 : f === 'pinky-finger' ? 0.0055 : 0.0064; n.scale.set(w, 0.0016, L * 0.42); n.position.set(0, w * 0.62, -L * 0.48); d.add(n); }
      // jacket sleeve cuff over the wrist, overlapping the avatar's forearm
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.029, 0.05, 20, 1, true), cuffMat); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.045; cuff.scale.set(1.12, 1, 0.82); cuff.material.side = THREE.DoubleSide; B.wrist.add(cuff);
      root.updateWorldMatrix(true, true); const wq = B.wrist.getWorldQuaternion(new THREE.Quaternion()); root.quaternion.premultiply(wq.invert()); root.updateWorldMatrix(true, true);
      const wp = B.wrist.getWorldPosition(new THREE.Vector3()); root.position.sub(wp).add(new THREE.Vector3(0, 0, 0.075)); // wrist sits behind the glove-frame palm centre
      this.g.add(root); this.ok = true; }).catch(e => console.warn('hand model', e)); }
  // vertex colour = crease / knuckle darkening + pore noise, from the bind-pose joint positions
  bake() { const G = this.mesh.geometry, P = G.attributes.position, n = P.count, C = new Float32Array(n * 3); this.mesh.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert(), J = []; for (const k in this.B) if (!/tip|wrist/.test(k)) J.push(new THREE.Vector3().setFromMatrixPosition(this.B[k].matrixWorld).applyMatrix4(inv));
    const v = new THREE.Vector3(); for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); let dm = 1; for (const j of J) dm = Math.min(dm, v.distanceTo(j)); const ring = Math.exp(-Math.pow((dm - 0.009) / 0.0035, 2));
      const nz = (Math.sin(v.x * 2100) * Math.sin(v.y * 1900) * Math.sin(v.z * 2300)) * 0.03; const k = 1 - ring * 0.22 + nz; C[i * 3] = k; C[i * 3 + 1] = k * (1 - ring * 0.05); C[i * 3 + 2] = k * (1 - ring * 0.08); }
    G.setAttribute('color', new THREE.BufferAttribute(C, 3)); }
  // controller poses: curls [index, middle, ring, pinky] 0..1, thumb 0..1, thumbUp: extended thumb
  pose(curls, thumb) { if (!this.ok) return; const B = this.B, R = this.rest, ax = new THREE.Vector3(), q = new THREE.Quaternion(), d = new THREE.Vector3();
    for (const f of FINGERS) { const ch = CH[f], c = f === 'thumb' ? thumb : curls[FINGERS.indexOf(f) - 1] ?? 0; const ang = f === 'thumb' ? [0.25, 0.7, 0.8, 0] : [0.08, 1.45, 1.55, 0.95, 0];
      let Rc = new THREE.Quaternion(); for (let k = 0; k < ch.length; k++) { const b = B[ch[k]]; if (!b) break; const r = R[ch[k]];
        if (k > 0) { const pr = R[ch[k - 1]]; d.copy(r.p).sub(pr.p).applyQuaternion(Rc); b.position.copy(B[ch[k - 1]].position).add(d); } else b.position.copy(r.p);
        ax.set(1, 0, 0).applyQuaternion(r.q).applyQuaternion(Rc); q.setFromAxisAngle(ax, -c * ang[k]); Rc = q.clone().multiply(Rc); b.quaternion.copy(Rc).multiply(r.q); } } }
  // hand tracking: copy the 25 XRHand joints straight onto the bones
  track(xrHand) { if (!this.ok || !xrHand?.joints) return false; let n = 0; const m = new THREE.Matrix4(), inv = new THREE.Matrix4();
    for (const k in this.B) { const j = xrHand.joints[k], b = this.B[k]; if (!j || !j.visible) continue; b.parent.updateWorldMatrix(true, false); inv.copy(b.parent.matrixWorld).invert(); m.multiplyMatrices(inv, j.matrixWorld); m.decompose(b.position, b.quaternion, new THREE.Vector3()); n++; }
    return n > 20; }
}
