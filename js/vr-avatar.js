// p55 VR full-body avatar: the real main character (person.js buildPerson('shak') -> real/me/rb.glb, same head mesh + textures,
// no substitute face) driven by the headset and hands.
//  - head-driven torso: pelvis placed under the head (standing / on foot) or on the driver's seat, spine + neck aimed at the head
//  - arms: analytic two-bone IK (UpperArm -> Forearm -> Hand) to the controller / tracked-hand pose with a down-and-out elbow pole
//  - legs: the model's own idle/walk/run clips on foot (speed driven), a seated pose (thighs forward, calves down) in the car
//  - head hidden from the first-person eye ONLY: a fragment discard within ~0.2 m of cameraPosition. Every other camera
//    (hero-car mirrors, puddle / window reflection cameras, shadow maps, spectators) still sees the full head and face.
//    This works per eye (three r160 renders XR eyes as separate cameras) and needs no layer cooperation from other workers:
//    any reflection pass that renders the scene from a mirrored camera includes the avatar automatically.
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const HIDE_R = 0.25; // any avatar surface (head, neck, shoulders, forearm) within 25 cm of the eye is not drawn for that eye
// rotate `bone` (world space) so the direction bone->child becomes `dir`
function aim(bone, child, dir) { bone.updateWorldMatrix(true, false); child.updateWorldMatrix(false, false);
  const p = _a.setFromMatrixPosition(bone.matrixWorld), cdir = _b.setFromMatrixPosition(child.matrixWorld).sub(p); if (cdir.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(cdir.normalize(), _c.copy(dir).normalize()); bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  const par = bone.parent; par.getWorldQuaternion(_q); bone.quaternion.copy(_q.invert().multiply(_q2)); bone.updateWorldMatrix(false, true); }
function headMask(m) { if (m.userData.vrMask) return; m.userData.vrMask = true; const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVrW;').replace('#include <project_vertex>', '#include <project_vertex>\nvVrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vVrW;\nuniform float uVrHide;').replace('void main() {', 'void main() {\n if (uVrHide > 0.5 && distance(vVrW, cameraPosition) < ' + HIDE_R.toFixed(3) + ') discard;');
    sh.uniforms.uVrHide = m.userData.uVrHide = m.userData.uVrHide || { value: 1 }; };
  m.customProgramCacheKey = () => 'vrmask'; m.needsUpdate = true; }
export class VRAvatar {
  constructor(vr) { this.vr = vr; this.g = buildPerson('shak'); this.g.name = 'vrAvatar'; this.P = this.g.userData.person; this.B = null; this.on = true; this.hideHead = true; }
  ready() { if (this.B) return true; const root = this.g.children.find(c => c.isObject3D && c.getObjectByName?.('Bip01_Pelvis')); if (!root) return false;
    const B = {}; root.traverse(o => { if (o.isBone || /^Bip01/.test(o.name)) B[o.name.replace('Bip01_', '')] = o; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of [].concat(o.material)) headMask(m); } });
    if (!B.Pelvis || !B.L_UpperArm || !B.Head) return false; this.B = B; this.root = root;
    // bone lengths from the bind pose
    root.updateWorldMatrix(true, true); const len = (x, y) => _a.setFromMatrixPosition(B[x].matrixWorld).distanceTo(_b.setFromMatrixPosition(B[y].matrixWorld));
    this.L = { ua: len('L_UpperArm', 'L_Forearm'), fa: len('L_Forearm', 'L_Hand'), hp: _a.setFromMatrixPosition(B.Head.matrixWorld).y - _b.setFromMatrixPosition(B.Pelvis.matrixWorld).y };
    return true; }
  setHideHead(v) { this.hideHead = v; this.g.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.userData.uVrHide) m.userData.uVrHide.value = v ? 1 : 0; }); }
  // two-bone IK, world-space target position + pole hint
  arm(side, T, pole, dirF, curl) { const B = this.B, S = side === 'left' ? 'L_' : 'R_', U = B[S + 'UpperArm'], F = B[S + 'Forearm'], H = B[S + 'Hand']; if (!U || !F || !H) return;
    const sp = new THREE.Vector3().setFromMatrixPosition(U.matrixWorld), a = this.L.ua, b = this.L.fa; const d = T.clone().sub(sp); let c = d.length(); c = THREE.MathUtils.clamp(c, Math.abs(a - b) + 1e-3, a + b - 1e-3); d.normalize();
    const cosA = (a * a + c * c - b * b) / (2 * a * c), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA)); const p = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
    const E = sp.clone().addScaledVector(d, a * cosA).addScaledVector(p, a * sinA); aim(U, F, E.clone().sub(sp));
    const ep = new THREE.Vector3().setFromMatrixPosition(F.matrixWorld); aim(F, H, sp.clone().addScaledVector(d, c).sub(ep));
    if (dirF && B[S + 'Finger2']) aim(H, B[S + 'Finger2'], dirF);
    const cu = curl || [0, 0, 0, 0, 0]; for (let f = 0; f < 5; f++) for (const sfx of ['', '1', '2']) { const b = B[S + 'Finger' + f + sfx]; if (!b) continue; const r0 = (b.userData.r0 ||= b.quaternion.clone());
      b.quaternion.copy(r0).multiply(_q.setFromAxisAngle(_d.set(0, 0, 1), -(f ? cu[f - 1] ?? 0 : cu[4] ?? 0) * (f ? 1.25 : 0.6))); }
    H.scale.setScalar(this.vr.opt.avatarHands ? 1 : 0.001); H.updateWorldMatrix(false, true); } // real VR hands (vr-hands.js) take over at the sleeve cuff; opt.avatarHands = the model's own hands (same skin + textures), fingers curled from the controller / tracked-hand curl
  // per frame. head: world pos of the eye, yaw: body yaw, hands {left,right}: world pos or null, mode 'seat' | 'foot'
  update(dt, { head, yaw, hands, mode, seatQ, speed = 0, dirs, curls }) { const g = this.g; g.visible = this.on; if (!this.on) return;
    if (!this.ready()) { g.position.copy(head).y -= 1.62; return; }
    const B = this.B; animPerson(g, dt, mode === 'foot' ? speed : 0, mode === 'foot' ? 'walk' : 'idle');
    if (seatQ) g.quaternion.copy(seatQ); else g.quaternion.setFromAxisAngle(_d.set(0, 1, 0), yaw);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion), right = new THREE.Vector3().crossVectors(fwd, up);
    // pelvis target
    const P = mode === 'seat' ? head.clone().addScaledVector(up, -this.L.hp * 0.93).addScaledVector(fwd, -0.2) : head.clone().addScaledVector(up, -this.L.hp).addScaledVector(fwd, -0.1);
    if (mode === 'foot' && this.groundY != null) P.y = Math.min(P.y, this.groundY + 1.0);
    g.updateWorldMatrix(true, true); const pw = _a.setFromMatrixPosition(B.Pelvis.matrixWorld); g.position.add(P.clone().sub(pw)); g.updateWorldMatrix(true, true);
    // torso / neck towards the head (eye sits ~9 cm ahead of the head bone)
    const headBone = head.clone().addScaledVector(fwd, -0.09).addScaledVector(up, -0.06); // head centre sits behind / below the eyes
    if (B.Spine && B.Neck) aim(B.Spine, B.Neck, headBone.clone().sub(_b.setFromMatrixPosition(B.Spine.matrixWorld)).lerp(up, 0.35));
    if (B.Neck && B.Head) aim(B.Neck, B.Head, headBone.clone().sub(_b.setFromMatrixPosition(B.Neck.matrixWorld)));
    // shoulders under the eyes (keeps the wheel in reach and the upper arms out of the eye's view)
    if (mode === 'seat' && B.L_UpperArm && B.R_UpperArm) { const M = new THREE.Vector3().setFromMatrixPosition(B.L_UpperArm.matrixWorld).add(_b.setFromMatrixPosition(B.R_UpperArm.matrixWorld)).multiplyScalar(0.5);
      const Mt = head.clone().addScaledVector(fwd, -0.07).addScaledVector(up, -0.22); g.position.add(Mt.sub(M)); g.updateWorldMatrix(true, true); }
    // seated legs: thighs forward (slightly up), calves down-forward to the pedals
    if (mode === 'seat') for (const S of ['L_', 'R_']) { const k = S === 'L_' ? -1 : 1;
      aim(B[S + 'Thigh'], B[S + 'Calf'], fwd.clone().addScaledVector(up, 0.12).addScaledVector(right, 0.08 * k));
      aim(B[S + 'Calf'], B[S + 'Foot'], fwd.clone().multiplyScalar(0.55).addScaledVector(up, -1)); }
    for (const s of ['left', 'right']) { const T = hands[s]; if (!T) continue; const k = s === 'left' ? -1 : 1; // elbows down, out and back: beside the body, clear of the eyes
      this.arm(s, T, up.clone().multiplyScalar(-1).addScaledVector(right, 0.8 * k).addScaledVector(fwd, 0.15), dirs?.[s], curls?.[s]); } }
}
