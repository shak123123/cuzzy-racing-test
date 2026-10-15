// Rendering: renderer, lighting/time of day, sky, rain, post-processing and graphics settings that really change
// what is rendered. Reflections are environment-map based (static or live cube-map probe) — not ray tracing,
// because WebGL in mobile/desktop browsers has no ray-tracing API.
import * as THREE from 'three';
import { RoomEnvironment } from './lib/addons/environments/RoomEnvironment.js';
import { EffectComposer } from './lib/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from './lib/addons/postprocessing/SMAAPass.js';
import { AfterimagePass } from './lib/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from './lib/addons/postprocessing/OutputPass.js';
import { GTAOPass } from './lib/addons/postprocessing/GTAOPass.js';
import { setCarEnv } from './carmodel.js';
import { RGBELoader } from './lib/addons/loaders/RGBELoader.js';
import { Sky } from './lib/addons/objects/Sky.js';
import { ShaderPass } from './lib/addons/postprocessing/ShaderPass.js';
import { installShaderSafety, patchGTAO, patchOutput, withSafe } from './shadersafe.js';
import { IS_MOBILE, IS_IOS } from './settings.js';
const IOS = IS_IOS;
const MOB = IS_MOBILE || /[?&]mob=1/.test(globalThis.location?.search || ''); // phone budget paths (GTAO off, 1024 shadows round the car, 2 lamps)
const CZ_SAFE = !/[?&]nosafe=1/.test(globalThis.location?.search || ''); // ?nosafe=1: old behaviour, for A/B checks on a device
if (CZ_SAFE) installShaderSafety(); // black-spot fix: finite colours in the HalfFloat target, safe normals (see shadersafe.js)

// ---------------------------------------------------------------------------------------------------------------
// High / Ultra "AAA" pipeline (Low / Medium keep their previous, cheaper path):
//  * physically based sky (Preetham/Hosek-style scattering, three's Sky) driven by a solar model for Birmingham
//    (52.48 N, late September), with a matching image-based-lighting environment baked from the same sky + skyline
//  * dynamic time of day: the sun keeps moving slowly (1 game hour per 12 real minutes, capped per session)
//  * contact-hardening soft sun shadows (PCSS: blocker search + variable-width PCF, sharp at contact, soft far away)
//  * ground-truth ambient occlusion (GTAOPass)
//  * atmosphere pass (HDR, before bloom): sun-directional Mie in-scatter haze, screen-space light shafts from the sky
//    between buildings, a subtle lens-flare ghost chain, and wet-road screen-space reflections when it rains
//  * filmic colour grade after tone mapping (contrast curve, split toning, saturation, vignette, fine grain) + SMAA
// ---------------------------------------------------------------------------------------------------------------
const LAT = 52.48 * Math.PI / 180, DECL = -2 * Math.PI / 180; // Birmingham, late September
const TOD_HOUR = { day: 13.4, sunset: 18.55, night: 23 }, TOD_DRIFT = { day: 1.6, sunset: 0.3, night: 0 };
export function sunDir(hour, out = new THREE.Vector3()) { // world: +x east, +y up, -z north; solar noon ~13:00 BST
  const H = (hour - 13.0) * 15 * Math.PI / 180;
  const e = -Math.cos(DECL) * Math.sin(H), n = Math.cos(LAT) * Math.sin(DECL) - Math.sin(LAT) * Math.cos(DECL) * Math.cos(H), u = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  return out.set(e, u, -n).normalize();
}
// PCSS for the directional (orthographic) sun shadow. Depth is linear in [0,1] over the shadow camera range, so the
// penumbra is proportional to the receiver-blocker distance in metres times the (slightly enlarged) sun angular size.
function pcssChunk(ext, range, samplesB, samplesF) {
  const k = range * 0.018 / (2 * ext); // uv radius per unit depth difference
  return `
  float czRand( vec2 co ) { return fract( sin( dot( co, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
  float czPCSS( sampler2D sm, vec2 size, vec4 c ) {
    vec2 uv = c.xy; float zr = c.z; float ang = czRand( gl_FragCoord.xy ) * 6.2831853; float texel = 1.0 / size.x;
    float search = ${(0.45 / (2 * ext)).toFixed(6)}; float bs = 0.0; float nb = 0.0;
    for ( int i = 0; i < ${samplesB}; i ++ ) { float fi = float( i ); float r = sqrt( ( fi + 0.5 ) / ${samplesB}.0 ); float a = fi * 2.3999632 + ang;
      float d = unpackRGBAToDepth( texture2D( sm, uv + vec2( cos( a ), sin( a ) ) * r * search ) ); if ( d < zr ) { bs += d; nb += 1.0; } }
    if ( nb < 0.5 ) return 1.0;
    float zb = bs / nb; float pen = clamp( ( zr - zb ) * ${k.toFixed(6)}, texel * 1.2, search );
    float s = 0.0;
    for ( int i = 0; i < ${samplesF}; i ++ ) { float fi = float( i ); float r = sqrt( ( fi + 0.5 ) / ${samplesF}.0 ); float a = fi * 2.3999632 + ang + 1.7;
      s += step( zr, unpackRGBAToDepth( texture2D( sm, uv + vec2( cos( a ), sin( a ) ) * r * pen ) ) ); }
    return s / ${samplesF}.0;
  }
`;
}
// installed once: the PCSS path is the PCF branch, and only High / Ultra use PCFShadowMap (Low / Medium keep
// PCFSoftShadowMap), so program cache keys differ and switching presets recompiles correctly
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment
  .replace('float getShadow(', pcssChunk(80, 890, 12, 16) + '\n\tfloat getShadow(')
  .replace('#if defined( SHADOWMAP_TYPE_PCF )', '#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tshadow = czPCSS( shadowMap, shadowMapSize, shadowCoord );\n\t\t#elif 0');
const AtmosShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, viewInv: { value: new THREE.Matrix4() }, viewProj: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, sunUV: { value: new THREE.Vector2() }, sunOn: { value: 0 },
    haze: { value: 0.0008 }, scatter: { value: 1 }, rays: { value: 0.35 }, flare: { value: 0.05 }, wet: { value: 0 }, aspect: { value: 1 }, time: { value: 0 }, raySteps: { value: 32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
  uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform mat4 projInv; uniform mat4 viewInv; uniform mat4 viewProj; uniform vec3 camPos; uniform vec3 sunDir; uniform vec3 sunCol;
  uniform vec2 sunUV; uniform float sunOn; uniform float haze; uniform float scatter; uniform float rays; uniform float flare; uniform float wet; uniform float aspect; uniform float time; uniform float raySteps;
  varying vec2 vUv;
  vec3 worldAt( vec2 uv, float d ) { vec4 v = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); v /= v.w; return ( viewInv * v ).xyz; }
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
  void main() {
    vec4 base = texture2D( tDiffuse, vUv ); vec3 col = base.rgb; float d = texture2D( tDepth, vUv ).x;
    col = min( czSafe3( col ), vec3( 64.0 ) ); // Inf -> bright, NaN -> 0 per component (was: whole pixel black) before GTAO / bloom spread it
    bool sky = d >= 0.99999;
    vec3 wp = sky ? camPos + normalize( worldAt( vUv, 0.999 ) - camPos ) * 3000.0 : worldAt( vUv, d );
    vec3 vd = normalize( wp - camPos ); float dist = length( wp - camPos );
    // wet road: screen-space reflection of a flat, puddled street (rain only)
    if ( wet > 0.0 && !sky && wp.y < 0.35 && dist < 160.0 && vd.y < -0.01 ) {
      vec3 rd = vec3( vd.x, -vd.y, vd.z ); vec3 hit = vec3( 0.0 ); float found = 0.0; float t = 0.6; vec2 huv = vUv;
      for ( int i = 0; i < 28; i ++ ) { t *= 1.22; vec3 p = wp + rd * t; vec4 c = viewProj * vec4( p, 1.0 ); vec2 uv = c.xy / c.w * 0.5 + 0.5;
        if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) break;
        float sd = texture2D( tDepth, uv ).x; vec3 sp = sd >= 0.99999 ? camPos + normalize( worldAt( uv, 0.999 ) - camPos ) * 5000.0 : worldAt( uv, sd );
        float ls = length( sp - camPos ), lp = length( p - camPos );
        if ( ls < lp && lp - ls < 1.5 + t * 0.35 ) { huv = uv; found = 1.0; break; }
        if ( sd >= 0.99999 && uv.y > 0.98 ) { huv = uv; found = 0.6; break; } }
      float puddle = smoothstep( 0.52, 0.75, vnoise( wp.xz * 0.11 ) * 0.7 + vnoise( wp.xz * 0.6 ) * 0.3 );
      float fres = 0.04 + 0.96 * pow( 1.0 - clamp( -vd.y, 0.0, 1.0 ), 5.0 );
      if ( found > 0.0 ) { float j = ( hash( vUv * 913.0 + time ) - 0.5 ) * 0.012 * ( 1.0 - puddle );
        vec3 r = ( texture2D( tDiffuse, huv + vec2( 0.0, j ) ).rgb + texture2D( tDiffuse, huv + vec2( 0.0, j - 0.006 ) ).rgb + texture2D( tDiffuse, huv + vec2( 0.0, j + 0.006 ) ).rgb ) / 3.0;
        float edge = smoothstep( 0.0, 0.08, huv.x ) * smoothstep( 1.0, 0.92, huv.x ) * smoothstep( 1.0, 0.9, huv.y ) * ( 1.0 - smoothstep( 90.0, 160.0, dist ) );
        float amt = wet * found * edge * mix( 0.22 + 0.5 * fres, 0.55 + 0.45 * fres, puddle ); col = mix( col, r, clamp( amt, 0.0, 0.85 ) ); }
    }
    // sun-directional Mie in-scatter (the aerial haze glows toward the sun, stays blue-grey away from it)
    if ( !sky ) { float mu = dot( vd, sunDir ); float g = 0.72; float ph = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 ) * 0.08;
      float f = 1.0 - exp( - dist * haze * 1.6 ); col += sunCol * ph * f * scatter; }
    // light shafts: radial march toward the sun collecting sky pixels (gaps between buildings and trees)
    if ( sunOn > 0.0 && rays > 0.0 ) { vec2 dlt = ( sunUV - vUv ); float L = length( dlt * vec2( aspect, 1.0 ) ); float acc = 0.0; float w = 1.0; float n = raySteps;
      vec2 st = dlt / n; vec2 u = vUv + st * hash( vUv * 517.0 + time );
      for ( int i = 0; i < 48; i ++ ) { if ( float( i ) >= n ) break; float sd = texture2D( tDepth, u ).x; acc += ( sd >= 0.99999 ? 1.0 : 0.0 ) * w; w *= 0.965; u += st; }
      acc /= n; float fall = exp( - L * 2.2 ); col += sunCol * acc * fall * rays * sunOn; }
    // lens flare: soft ghosts along the axis through the screen centre, only while the sun disc is unoccluded
    if ( sunOn > 0.0 && flare > 0.0 ) { float vis = 0.0; for ( int i = 0; i < 9; i ++ ) { vec2 o = vec2( float( i - ( i / 3 ) * 3 ) - 1.0, float( i / 3 ) - 1.0 ) * 0.006; vis += texture2D( tDepth, sunUV + o ).x >= 0.99999 ? 1.0 : 0.0; } vis /= 9.0;
      vec2 ax = vec2( 0.5 ) - sunUV; vec3 fl = vec3( 0.0 );
      for ( int i = 0; i < 5; i ++ ) { float fi = float( i ); float pos = 0.35 + fi * 0.38; float rad = 0.018 + 0.03 * fract( fi * 0.618 ); vec2 gp = sunUV + ax * pos * 2.0;
        float dd = length( ( vUv - gp ) * vec2( aspect, 1.0 ) ); float gh = smoothstep( rad, rad * 0.55, dd );
        fl += gh * vec3( 0.6 + 0.4 * sin( fi * 2.1 ), 0.65 + 0.3 * sin( fi * 1.3 + 1.0 ), 0.8 + 0.2 * cos( fi ) ); }
      float halo = smoothstep( 0.03, 0.0, abs( length( ( vUv - sunUV ) * vec2( aspect, 1.0 ) ) - 0.32 ) ) * 0.35;
      col += ( fl + halo ) * sunCol * flare * vis * sunOn; }
    gl_FragColor = vec4( col, base.a );
  }`,
};
AtmosShader.fragmentShader = withSafe(AtmosShader.fragmentShader);
class AtmosPass extends ShaderPass { render(r, w, rb, dt, m) { this.uniforms.tDepth.value = rb.depthTexture; super.render(r, w, rb, dt, m); } }
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, contrast: { value: 0.22 }, sat: { value: 1.06 }, shadowTint: { value: new THREE.Vector3(0.985, 1.0, 1.03) }, hiTint: { value: new THREE.Vector3(1.025, 1.0, 0.965) }, vig: { value: 0.22 }, grain: { value: 0.012 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float contrast; uniform float sat; uniform vec3 shadowTint; uniform vec3 hiTint; uniform float vig; uniform float grain; varying vec2 vUv;
  float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
  void main() { vec4 t = texture2D( tDiffuse, vUv ); vec3 c = clamp( t.rgb, 0.0, 1.0 ); float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c *= mix( shadowTint, hiTint, smoothstep( 0.15, 0.75, l ) ); // split toning: cool shadows, warm highlights
    c = mix( c, c * c * ( 3.0 - 2.0 * c ), contrast ); // filmic S-curve (toe and shoulder)
    l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); c = mix( vec3( l ), c, sat );
    vec2 q = vUv - 0.5; c *= 1.0 - vig * smoothstep( 0.25, 0.85, dot( q, q ) * 2.2 );
    c += ( h( vUv * 1000.0 + time ) - 0.5 ) * grain;
    gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), t.a ); }`,
};

// Upscaler for Sharp mode: the post chain runs at the internal (dynamic) resolution, this last pass draws the full-res
// canvas. FSR 1-style in spirit, not AMD's code: EASU is replaced by a Catmull-Rom 4x4 filter (9 bilinear fetches)
// with EASU-like anti-ringing (result clamped to the 2x2 source neighbourhood), then RCAS-style contrast-adaptive
// sharpening (FSR 1 RCAS lobe formula, limited so it never creates halos), all in one full-screen pass. NaN-safe.
const UpscaleShader = {
  uniforms: { tDiffuse: { value: null }, srcSize: { value: new THREE.Vector2(1, 1) }, dstSize: { value: new THREE.Vector2(1, 1) }, sharp: { value: 0.8 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 srcSize; uniform vec2 dstSize; uniform float sharp; varying vec2 vUv;
  vec3 tx( vec2 uv ) { return texture2D( tDiffuse, uv ).rgb; }
  vec3 up( vec2 uv ) { // Catmull-Rom 4x4 via 9 bilinear taps, anti-ringing clamp to the nearest 2x2 texels
    vec2 sp = uv * srcSize; vec2 t1 = floor( sp - 0.5 ) + 0.5; vec2 f = sp - t1;
    vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) ), w1 = 1.0 + f * f * ( -2.5 + 1.5 * f ), w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) ), w3 = f * f * ( -0.5 + 0.5 * f );
    vec2 w12 = w1 + w2; vec2 t0 = ( t1 - 1.0 ) / srcSize, t3 = ( t1 + 2.0 ) / srcSize, tc = ( t1 + w2 / w12 ) / srcSize;
    vec3 c = ( tx( vec2( t0.x, t0.y ) ) * w0.x + tx( vec2( tc.x, t0.y ) ) * w12.x + tx( vec2( t3.x, t0.y ) ) * w3.x ) * w0.y
           + ( tx( vec2( t0.x, tc.y ) ) * w0.x + tx( vec2( tc.x, tc.y ) ) * w12.x + tx( vec2( t3.x, tc.y ) ) * w3.x ) * w12.y
           + ( tx( vec2( t0.x, t3.y ) ) * w0.x + tx( vec2( tc.x, t3.y ) ) * w12.x + tx( vec2( t3.x, t3.y ) ) * w3.x ) * w3.y;
    vec2 i = 1.0 / srcSize; vec3 a = tx( t1 * i ), b = tx( ( t1 + vec2( 1.0, 0.0 ) ) * i ), d = tx( ( t1 + vec2( 0.0, 1.0 ) ) * i ), e = tx( ( t1 + 1.0 ) * i );
    return clamp( c, min( min( a, b ), min( d, e ) ), max( max( a, b ), max( d, e ) ) ); }
  void main() {
    vec2 o = 1.0 / dstSize; vec3 c = up( vUv );
    if ( sharp > 0.0 ) { // RCAS: cross neighbours one output pixel away (bilinear from the source; cheap approximation)
      vec3 n = tx( vUv + vec2( 0.0, o.y ) ), s = tx( vUv - vec2( 0.0, o.y ) ), e = tx( vUv + vec2( o.x, 0.0 ) ), w = tx( vUv - vec2( o.x, 0.0 ) );
      vec3 mn = min( min( min( n, s ), min( e, w ) ), c ), mx = max( max( max( n, s ), max( e, w ) ), c );
      vec3 hitMin = mn / max( 4.0 * mx, vec3( 1e-4 ) ), hitMax = ( 1.0 - mx ) / min( 4.0 * mn - 4.0, vec3( -1e-4 ) );
      vec3 l3 = max( -hitMin, hitMax ); float lobe = max( -0.1875, min( max( l3.r, max( l3.g, l3.b ) ), 0.0 ) ) * sharp;
      c = ( lobe * ( n + s + e + w ) + c ) / ( 4.0 * lobe + 1.0 ); }
    gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 ); }`,
};

// the filmic grade appended to OutputPass (same maths as GradeShader, run on the tone-mapped sRGB colour)
function foldGrade(op) {
  const m = op.material, U = THREE.UniformsUtils.clone(GradeShader.uniforms); delete U.tDiffuse; Object.assign(m.uniforms, U);
  const f = m.fragmentShader, i = f.lastIndexOf('}');
  m.fragmentShader = f.slice(0, i).replace('varying vec2 vUv;', 'varying vec2 vUv; uniform float time; uniform float contrast; uniform float sat; uniform vec3 shadowTint; uniform vec3 hiTint; uniform float vig; uniform float grain;\n float czGh( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }') + `
    { vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 ); float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c *= mix( shadowTint, hiTint, smoothstep( 0.15, 0.75, l ) ); c = mix( c, c * c * ( 3.0 - 2.0 * c ), contrast );
      l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); c = mix( vec3( l ), c, sat ); vec2 q = vUv - 0.5; c *= 1.0 - vig * smoothstep( 0.25, 0.85, dot( q, q ) * 2.2 );
      c += ( czGh( vUv * 1000.0 + time ) - 0.5 ) * grain; gl_FragColor.rgb = clamp( c, 0.0, 1.0 ); }
}`;
  m.needsUpdate = true; return { uniforms: m.uniforms };
}
const TOD = {
  day: { zen: 0x4f7fb8, hor: 0xcfdbe6, gnd: 0x4a4a48, sky: 0x9fbad6, fog: 0xaec2d6, hemi: [0xdfe9ff, 0x5a5448, 1.25], sun: [0xfff2dc, 2.6], sunPos: [320, 520, 180], exp: 1.0 },
  sunset: { zen: 0x40507a, hor: 0xf4a36c, gnd: 0x2c2426, sky: 0xe39a6a, fog: 0xc98f72, hemi: [0xffc4a0, 0x3a3040, 0.9], sun: [0xffa060, 2.2], sunPos: [-600, 120, 300], exp: 1.0 },
  night: { zen: 0x03060e, hor: 0x1c2436, gnd: 0x0a0a0c, sky: 0x0b1020, fog: 0x121826, hemi: [0x4a5a80, 0x151515, 0.35], sun: [0x8aa0ff, 0.25], sunPos: [-200, 400, -300], exp: 1.25 },
};

// look: 3D colour LUT stored as a 256 x 16 strip (b slices left to right), applied to the display-referred colour
let _lut = null; function lutTex() { if (_lut) return _lut; _lut = new THREE.TextureLoader().load('./img/city/lut_uk_overcast.png'); _lut.minFilter = _lut.magFilter = THREE.LinearFilter; _lut.generateMipmaps = false; _lut.colorSpace = THREE.NoColorSpace; return _lut; }
const LutShader = { uniforms: { tDiffuse: { value: null }, lut: { value: null }, amt: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D lut; uniform float amt; varying vec2 vUv;
  vec3 lk( vec3 c ) { float N = 16.0; c = clamp( c, 0.0, 1.0 ); float b = c.b * ( N - 1.0 ); float b0 = floor( b ), b1 = min( b0 + 1.0, N - 1.0 );
    vec2 uv = vec2( ( c.r * ( N - 1.0 ) + 0.5 ) / ( N * N ), ( c.g * ( N - 1.0 ) + 0.5 ) / N ); uv.y = 1.0 - uv.y;
    return mix( texture2D( lut, uv + vec2( b0 / N, 0.0 ) ).rgb, texture2D( lut, uv + vec2( b1 / N, 0.0 ) ).rgb, b - b0 ); }
  void main() { vec4 t = texture2D( tDiffuse, vUv ); gl_FragColor = vec4( mix( t.rgb, lk( t.rgb ), amt ), t.a ); }` };
export class Gfx {
  constructor(canvas, settings) {
    this.s = settings; this.canvas = canvas;
    // Some browsers (e.g. a Mac with graphics acceleration off or the GPU busy) refuse the first request; retry with safer options before giving up
    const tries = [{ powerPreference: 'high-performance' }, { powerPreference: 'default' }, { powerPreference: 'low-power', failIfMajorPerformanceCaveat: false, precision: 'mediump' }];
    for (const o of tries) { try { this.r = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, ...o }); break; } catch (e) { this.glErr = e; } }
    if (!this.r) {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#0b0d10;color:#fff;font:16px/1.5 system-ui,sans-serif';
      d.innerHTML = '<div><b>3D graphics are switched off in this browser</b><br>Turn on hardware acceleration (Chrome: Settings, System, Use graphics acceleration), close other heavy tabs, then reload. Safari and Chrome both work.<br><br><button onclick="location.reload()" style="background:transparent;color:#fff;border:1px solid #fff;border-radius:8px;padding:8px 18px;font:inherit">Reload</button></div>';
      document.body.appendChild(d); throw new Error('WebGL unavailable (handled): ' + (this.glErr && this.glErr.message));
    }
    this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = /[?&]aces=1/.test(location.search) ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping; // look: AgX (softer highlight roll-off, less 'video game' saturation) this.r.toneMappingExposure = 1;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap; this.r.shadowMap.autoUpdate = false; // shadow map drawn once per frame (render()), not again for the probe face / GTAO normals / transmission renders
    const gl = this.r.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown GPU'; this.webgl2 = this.r.capabilities.isWebGL2;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(62, 1, 0.12, 2500);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.castShadow = true; this.scene.add(this.sun, this.sun.target);
    // exponential-squared haze (aerial perspective): clear near the car, distance fades naturally into the sky colour
    this.scene.fog = new THREE.FogExp2(0xaec2d6, 0.0008);
    const pm = new THREE.PMREMGenerator(this.r);
    this.roomEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.cube = null; this.fps = 0; this.frames = 0; this.fpsT = performance.now(); this.fpsHist = []; this.fc = 0;
    // genuine frame statistics from rAF deltas of drawn frames (no smoothing tricks): 1 s average fps / frame ms, 1% low
    // over the last ~10 s, display refresh measured from the rAF rate
    this.ft = new Float32Array(1200); this.ftN = 0; this.ftI = 0; this.lastDrawT = 0; this.rafT = 0; this.rafD = []; this.displayHz = 60;
    this.stat = { fps: 0, ms: 0, low1: 0, cpu: 0, hz: 60 }; this.secN = 0; this.secMs = 0; this.secCpu = 0;
    this.dynScale = 1; this.dynT = 0; this.dynEma = 0; this.dynCpu = 0; this.dynBlock = 0; this.dynUpAt = 0;
    this.shN = 0; this._shC = new THREE.Vector3(1e9, 0, 0); this._shO = new THREE.Vector3(1e9, 0, 0);
    this.rainOn = false; this.tod = 'day';
    this.resize(); addEventListener('resize', () => this.resize());
    this.apply();
    // first-game sky: photographic HDR environment (lighting + reflections) and a matching photo sky backdrop, used for clear daytime
    new RGBELoader().load('./real/tex/sky1k.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; const pm = new THREE.PMREMGenerator(this.r); this.hdrEnv = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose(); this.setTOD(this.tod, this.rainOn); });
    new RGBELoader().load('./real/tex/overcast1k.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; const pm = new THREE.PMREMGenerator(this.r); this.ocEnv = pm.fromEquirectangular(t).texture; pm.dispose(); this.ocSky = t; this.setTOD(this.tod, this.rainOn); }); // look: Poly Haven kloofendal_overcast_puresky (CC0), British-style flat overcast
    new THREE.TextureLoader().load('./real/tex/skybg.jpg', t => { t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; this.skyPhoto = t; this.setTOD(this.tod, this.rainOn); });
  }
  resize() {
    if (this.r.xr?.isPresenting) return; // p52: the XR layer owns the size
    const w = innerWidth, h = innerHeight; const g = this.s.graphics;
    const up = this.upMode(), base = Math.min(devicePixelRatio || 1, g.dprCap || 2, IOS ? 1.5 : 9);
    const sc = up === 'off' ? 1 : g.resAuto ? this.dynScale : g.res;
    // Bilinear: the canvas itself is at the internal resolution and the browser stretches it. Sharp: the canvas is at full
    // (DPR-capped) resolution, the scene + post chain run at the internal resolution and UpscaleShader draws the canvas.
    this.ipr = base * sc; this.r.setPixelRatio(this.upPass ? base : this.ipr); this.r.setSize(w, h, false); // the DOM HUD / menus stay at full device resolution
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.ipr); this.composer.setSize(w, h); }
    if (this.upPass) { const U = this.upPass.uniforms; U.srcSize.value.set(Math.round(w * this.ipr), Math.round(h * this.ipr)); U.dstSize.value.set(Math.round(w * base), Math.round(h * base)); this.upPass.enabled = sc < 0.999; }
    if (this.outPass) { const pr = this.ipr; this.outPass.material.uniforms.czPx.value.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr)); }
    if (this.gtao && g.envDetail < 3) this.gtao.setSize(w * this.ipr * 0.5, h * this.ipr * 0.5);
    this.resized = (this.resized || 0) + 1;
  }
  apply() {
    const g = this.s.graphics;
    this.r.shadowMap.enabled = g.shadows > 0;
    const hi = g.envDetail >= 2, pcss = hi && g.shadows >= 2; this.r.shadowMap.type = pcss ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; this.r.shadowMap.needsUpdate = true; // High+: contact-hardening PCSS // High / Ultra: sharper and wider sun shadows (buildings, trees and street clutter cast them)
    // High: PCSS 2048 over ±70 m, Ultra: PCSS 4096 over ±90 m (every frame). Low (Medium / Adaptive): soft PCF 2048 in a
    // tight ±40-45 m box round the car. Every preset: redrawn every frame, centre texel-snapped in light space (follow())
    const ms = IOS ? 1024 : MOB ? 1024 : pcss ? (g.envDetail >= 3 ? 4096 : 2048) : 2048; this.sun.shadow.mapSize.set(ms, ms);
    const sc = this.sun.shadow.camera; const ext = MOB && g.shadows > 0 ? 40 : pcss ? (g.envDetail >= 3 ? 90 : 70) : g.shadows > 1 ? 60 : hi ? 45 : 40; this.shExt = ext; this.shEvery = 1; // phones: 1024 map, ±40 m round the car. Redrawn EVERY frame on every preset (car-shadow flashing fix: a throttled map left the car's shadow up to 2 frames behind the car, and the redraw used to happen inside the probe render with the car hidden)
    this.sun.shadow.autoUpdate = true; this.sun.shadow.needsUpdate = true; this._shC.set(1e9, 0, 0); sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 900; sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.03; if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.cam.far = g.drawDist + 300; this.cam.updateProjectionMatrix();
    // reflections: 0 = none (flat ambient), 1 = static environment map, 2 = live cube-map probe around the player's car
    // 2 = dynamic car probe: a cube camera at the player's car, PMREM-filtered after each full turn so paint roughness
    // picks the right blur. Fast refresh: High / Ultra 256 px (PMREM works in powers of two, so 192 would be filtered at
    // 128 anyway), all six faces every frame on desktop, 3 faces per frame on phones (full refresh every 2 frames);
    // Medium 128 px, 2 faces per frame (every 3 frames). The cube stays at one position for all faces of a turn (no seams).
    const cs = g.reflections >= 2 && g.envDetail >= 1 ? (g.envDetail >= 2 ? 256 : 128) : 0;
    if (this.cube && this.cubeRT.width !== cs) { this.scene.remove(this.cube); this.cubeRT.dispose(); this.cube = null; this._cubeInit = false; }
    if (cs && !this.cube) { this.cubeRT = new THREE.WebGLCubeRenderTarget(cs, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter }); this.cube = new THREE.CubeCamera(0.4, 300, this.cubeRT); this.scene.add(this.cube); this.cubeFace = 0; this.cubeN = 0; }
    if (this.cube) { this.cubeEvery = 1; this.cubeFacesPer = g.envDetail >= 2 ? (MOB ? 3 : 6) : 2; const pf = g.envDetail >= 3 ? (MOB ? 300 : 400) : g.envDetail >= 2 ? (MOB ? 240 : 320) : 160; // reduced probe scene: shorter far on phones / Medium (fog + 128-256 px hide the rest; parked cars / peds / player car already left out)
      for (const c of this.cube.children) if (c.far !== pf) { c.far = pf; c.near = 0.4; c.updateProjectionMatrix(); } }
    const env = g.reflections === 0 ? null : this.cube ? this.cubeRT.texture : (this.cityEnv || this.roomEnv);
    setCarEnv(env); this.scene.environment = g.reflections === 0 ? null : (this.cityEnv || this.roomEnv);
    this.buildComposer(); this.resize(); this.setTOD(this.tod, this.rainOn);
  }
  // upscaling: 'off' = native resolution (render scale ignored), 'bilinear' = browser stretch of a smaller canvas,
  // 'sharp' = Catmull-Rom + RCAS pass (needs the post chain; Low / Medium without post effects fall back to bilinear).
  // Default: Sharp on Ultra Adaptive / Auto resolution, Bilinear otherwise.
  upMode() { const g = this.s.graphics; const m = g.upscale || (g.preset === 'adaptive' || g.resAuto ? 'sharp' : 'bilinear'); return m === 'sharp' && !this.hasPost() ? 'bilinear' : m; }
  hasPost() { const g = this.s.graphics, fx = g.effects ?? (g.bloom ? 2 : 0); return !(g.aa === 'off' && !(g.bloom && fx >= 1) && !g.motionBlur); }
  buildComposer() {
    const g = this.s.graphics; this.composer?.dispose?.(); this.composer = null; this.upPass = null; this.outPass = null;
    const fx = g.effects ?? (g.bloom ? 2 : 0), bloomOn = g.bloom && fx >= 1;
    if (g.aa === 'off' && !bloomOn && !g.motionBlur) return;
    const hi = g.envDetail >= 2, deep = hi && fx >= 2; let rt; // deep: atmosphere + GTAO passes (need scene depth)
    if (deep) { const pr = this.ipr || this.r.getPixelRatio(); rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType }); rt.depthTexture = new THREE.DepthTexture(innerWidth * pr, innerHeight * pr); rt.depthTexture.type = THREE.UnsignedIntType; }
    const c = new EffectComposer(this.r, rt); c.addPass(new RenderPass(this.scene, this.cam));
    if (deep) { const pr = this.r.getPixelRatio(); for (const t of [c.renderTarget1, c.renderTarget2]) { t.depthTexture = new THREE.DepthTexture(innerWidth * pr, innerHeight * pr); t.depthTexture.type = THREE.UnsignedIntType; } } // cloned depth textures share one GPU texture (feedback loop): give each its own
    // High / Ultra: atmosphere (in-scatter haze, light shafts, lens flare, wet-road reflections) in HDR, before AO/bloom
    this.atmos = null; if (deep) { this.atmos = new AtmosPass(AtmosShader); this.atmos.uniforms.raySteps.value = MOB ? 16 : g.envDetail >= 3 ? 44 : 28; c.addPass(this.atmos); }
    // High / Ultra: ground-truth ambient occlusion (contact shadows where walls meet pavements, under awnings, round kerbs)
    this.gtao = null; if (g.ao !== false && deep && !MOB) { /* GTAO: desktop only (too expensive on a phone) */ const pr = this.r.getPixelRatio(), s = g.envDetail >= 3 ? 1 : 0.5; this.gtao = new GTAOPass(this.scene, this.cam, innerWidth * pr * s, innerHeight * pr * s);
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1, samples: g.envDetail >= 3 ? 16 : 10, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: g.envDetail >= 3 ? 16 : 8 }); this.gtao.blendIntensity = 0.8; patchGTAO(this.gtao); c.addPass(this.gtao); }
    this.bloom = null; if (bloomOn) { const b = this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.55, 0.88);
      if (fx < 2) { const ss = b.setSize.bind(b); b.setSize = (w, h) => ss(Math.max(64, w * 0.5), Math.max(64, h * 0.5)); } // Low effects: bloom mips at half the (already halved) size
      // NaN / Inf guard + firefly clamp at the bloom input: one NaN pixel (e.g. from a degenerate normal) used to be spread by
      // the blur mips into a black box; single over-bright specular pixels on glass became sparkles
      const hp = b.materialHighPassFilter; hp.fragmentShader = withSafe(hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = min( czSafe3( texel.rgb ), vec3( 24.0 ) ); texel.a = czSafe1( texel.a, 1.0 );')); hp.needsUpdate = true;
      c.addPass(b); }
    if (g.motionBlur) { this.blur = new AfterimagePass(0.55); c.addPass(this.blur); }
    const op = new OutputPass(); if (CZ_SAFE) patchOutput(op); else { op.material.uniforms.czPx = { value: new THREE.Vector2() }; op.material.fragmentShader = op.material.fragmentShader.replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv ); if ( !( abs( gl_FragColor.r ) + abs( gl_FragColor.g ) + abs( gl_FragColor.b ) < 1e30 ) ) gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );'); } this.outPass = op; c.addPass(op); if (g.envDetail >= (MOB ? 2 : 1) && !/[?&]nolut=1/.test(location.search)) { this.lutPass = new ShaderPass(LutShader); this.lutPass.uniforms.lut.value = lutTex(); c.addPass(this.lutPass); } // look: UK-overcast colour grade LUT (16^3 strip) // NaN repaired from neighbours, Inf = bright (the old guard painted both black)
    this.grade = null; if (hi && fx >= 1) this.grade = foldGrade(op); // filmic grade in display space, folded into the output pass (one full-screen pass less)
    if (g.aa === 'smaa') c.addPass(new SMAAPass(innerWidth * this.r.getPixelRatio(), innerHeight * this.r.getPixelRatio()));
    this.upPass = null; if (this.upMode() === 'sharp') { this.upPass = new ShaderPass(UpscaleShader); this.upPass.uniforms.sharp.value = g.upSharp ?? 0.8; c.addPass(this.upPass); } // last: draws the full-res canvas
    this.composer = c;
  }
  // p51 continuous day/night + weather: o = Environment.out (daynight-weather.js), hour 0..24. Uses this renderer's own
  // presets (setTOD) for the heavy state (sky model, env map, lamps, rain) and blends light, fog and sun position every frame.
  setClock(o, hour) { const rain = o.rain > 0.35; const name = o.night > 0.8 ? 'night' : (o.dusk > 0.4 || o.day < 0.6) ? 'sunset' : 'day';
    const ov = !rain && o.cloud > 0.6 && name !== 'night'; /* overcast: grey sky dome, no photo/physical blue sky */ if (name !== this.tod || rain !== this.rainOn || ov !== !!this.ovOn || !this.fogD0) { this.setTOD(name, rain, ov); this.fogD0 = this.scene.fog.density; this.clockEnvH = hour; }
    this.dynTOD = false; this.hour = hour;
    if (this.physSky) { this.placeSun(); if (Math.abs(hour - (this.clockEnvH ?? hour)) > 0.5) { this.clockEnvH = hour; const g = this.s.graphics; this.cityEnv = this.makeSkyEnv(this.tod); if (g.reflections >= 1) this.scene.environment = this.cityEnv; if (g.reflections >= 1 && !this.cube) setCarEnv(this.cityEnv); } }
    else if (this.sunOff && o.lightDir) { this.sunOff.copy(o.lightDir).multiplyScalar(300); }
    const B = this.sunBase; if (B) { const sk = this.physSky ? this.sun.intensity : B.I; this.sun.intensity = sk * (1 - 0.6 * o.cloud * (name === 'night' ? 0.3 : 1)) * (1 - 0.35 * o.fog) + (o.flash || 0) * 3; this.hemi.intensity = (this.physSky ? this.hemi.intensity : B.hemiI) * (1 - 0.12 * o.cloud) + (o.flash || 0) * 1.6; }
    this.scene.fog.density = this.fogD0 * (1 + o.fog * 5 + o.cloud * 0.4); if (this.fogBase) { this.fogBase.copy(this.scene.fog.color); if (o.fog > 0.2 && !this.night) this.scene.fog.color.lerp(this._fogG || (this._fogG = new THREE.Color(0xa9aeb5)), o.fog * 0.5); }
    if (this.dome?.visible) { const U = this.dome.material.uniforms; const gr = this._skyG || (this._skyG = new THREE.Color(0x7d848d)); U.zen.value.lerp(gr, o.cloud * 0.05); U.hor.value.lerp(gr, o.cloud * 0.03); }
  }
  setTOD(name, rain, ov = false) {
    this.tod = name; this.rainOn = rain; this.ovOn = ov; const wetSky = rain; rain = rain || ov; /* overcast shares the grey-sky path; rain-only bits use wetSky */ const T = TOD[name] || TOD.day; const g = this.s.graphics;
    const skyC = new THREE.Color(T.sky); const fogC = new THREE.Color(T.fog);
    if (rain) { skyC.lerp(new THREE.Color(0x6b7480), 0.65); fogC.lerp(new THREE.Color(0x7a828c), 0.6); }
    this.scene.background = skyC; this.scene.fog.color = fogC;
    // gradient sky dome + a matching "city" environment map so paint and glass reflect a sky, horizon and skyline
    const zen = new THREE.Color(T.zen), hor = new THREE.Color(T.hor); if (rain) { zen.lerp(new THREE.Color(0x5d656f), 0.7); hor.lerp(new THREE.Color(0x8a9199), 0.6); }
    if (!this.dome) { this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, fog: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 100.0, 1.0); gl_Position = p.xyww; }',
      fragmentShader: 'uniform vec3 zen; uniform vec3 hor; uniform vec3 fog; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(hor, zen, pow(clamp(h,0.0,1.0), 0.55)); c = mix(fog, c, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c,1.0); }' }));
      this.dome.frustumCulled = false; this.dome.renderOrder = -10; this.dome.scale.setScalar(1000); this.scene.add(this.dome); }
    this.dome.material.uniforms.zen.value.copy(zen); this.dome.material.uniforms.hor.value.copy(hor); this.dome.material.uniforms.fog.value.copy(fogC);
    const hi = g.envDetail >= 2; this.overcast = name === 'day' && !rain && !!this.ocEnv && !/[?&]clear=1/.test(location.search); this.physSky = hi && !rain && name !== 'night' && !this.overcast; // High+: physically based sky + sun
    this.hour = TOD_HOUR[name] ?? 13.4; this.hour0 = this.hour;
    const photo = !this.physSky && name === 'day' && !rain && this.skyPhoto && this.hdrEnv; // Low/Medium clear day: first-game photo sky + HDR lighting
    this.dome.visible = !photo && !this.physSky; if (photo) { this.scene.background = this.skyPhoto; this.scene.backgroundIntensity = 1.0; this.scene.backgroundBlurriness = 0; }
    if (this.physSky) { this.ensureSky(); this.skyParams(name); this.sky.visible = true; this.scene.background = null; } else if (this.sky) this.sky.visible = false;
    this.cityEnv = photo ? this.hdrEnv : this.physSky ? this.makeSkyEnv(name) : this.makeCityEnv(name, rain, zen, hor, new THREE.Color(T.gnd)); if (g.reflections >= 1 && !this.cube) { setCarEnv(this.cityEnv); } if (g.reflections >= 1) this.scene.environment = this.cityEnv;
    if (this.overcast) { this.dome.visible = false; this.scene.background = this.ocSky; this.scene.backgroundIntensity = 0.9; this.scene.backgroundBlurriness = 0; this.cityEnv = this.ocEnv; if (g.reflections >= 1 && !this.cube) setCarEnv(this.ocEnv); if (g.reflections >= 1) this.scene.environment = this.ocEnv; }
    // haze density: light on a clear day (~18% at 500 m), thicker at night and much thicker in rain (~40% at 200 m)
    this.scene.fog.density = wetSky ? 0.0032 : ov ? 0.0016 : name === 'night' ? 0.0013 : name === 'sunset' ? 0.001 : 0.0008 * Math.max(1, 1300 / g.drawDist);
    this.hemi.color.set(T.hemi[0]); this.hemi.groundColor.set(T.hemi[1]); this.hemi.intensity = T.hemi[2] * (rain ? 0.8 : 1);
    this.sun.color.set(T.sun[0]); this.sun.intensity = T.sun[1] * (wetSky ? 0.35 : ov ? 0.5 : 1); this.sunOff = new THREE.Vector3(...T.sunPos).normalize().multiplyScalar(300);
    if (this.overcast) { this.sun.color.set(0xf3f1ec); this.sun.intensity = 1.4; this.hemi.color.set(0xd9dee4); this.hemi.groundColor.set(0x4a4744); this.hemi.intensity = g.reflections >= 1 ? 0.35 : 1.1; this.sunOff = new THREE.Vector3(220, 560, 260).normalize().multiplyScalar(300); this.scene.fog.color.set(0xb9bec4); this.scene.fog.density = 0.0016 * Math.max(1, 1300 / g.drawDist); fogC.set(0xb9bec4); this.hour = 12.8; }
    this.sunBase = { col: new THREE.Color(T.sun[0]), I: this.sun.intensity, hemiI: this.hemi.intensity }; this.fogBase = fogC.clone();
    if (this.physSky) this.placeSun();
    if (this.grade) { const U = this.grade.uniforms; const night = name === 'night';
      U.contrast.value = night ? 0.22 : rain ? 0.16 : 0.24; U.sat.value = night ? 1.0 : rain ? 0.94 : name === 'sunset' ? 1.06 : 1.03; U.vig.value = night ? 0.18 : 0.12;
      U.grain.value = 0; // clean glass/paint and stable fine detail, especially after adaptive upscaling
      U.shadowTint.value.set(...(night ? [0.96, 1.0, 1.07] : rain ? [0.98, 1.0, 1.03] : [0.985, 1.0, 1.03])); U.hiTint.value.set(...(night ? [1.04, 1.0, 0.94] : name === 'sunset' ? [1.04, 1.0, 0.95] : [1.025, 1.0, 0.965])); }
    this.r.toneMappingExposure = this.overcast ? 1.05 : photo ? 0.85 : this.physSky ? 0.94 : rain ? 1.1 : T.exp; this.night = name === 'night';
    if (this.bloom) { this.bloom.strength = name === 'night' ? (hi ? 0.36 : 0.5) : rain ? (hi ? 0.18 : 0.25) : (hi ? 0.12 : 0.16); this.bloom.threshold = name === 'night' ? (hi ? 0.88 : 0.82) : 0.9; this.bloom.radius = hi ? 0.42 : name === 'night' ? 0.5 : 0.55; } // retain lamp glow without washing out paint and road detail
    this.scene.environmentIntensity = this.overcast ? 1.15 : name === 'night' ? 0.6 : rain ? 0.85 : 1;
    this.nightLights(name === 'night' || wetSky);
    if (wetSky && g.weatherFx && !this.rain) this.makeRain(); if (this.rain) this.rain.visible = wetSky && g.weatherFx;
  }
  ensureSky() {
    if (this.sky) return; this.sky = this.newSky(); this.sky.scale.setScalar(1500); this.sky.frustumCulled = false; this.sky.renderOrder = -10; this.scene.add(this.sky);
  }
  newSky() { const s = new Sky(); const m = s.material; m.uniforms.skyGain = { value: 0.5 }; m.fragmentShader = 'uniform float skyGain;\n' + m.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( clamp( retColor * skyGain, 0.0, 30000.0 ), 1.0 );'); m.depthWrite = false; return s; }
  skyParams(name, s = this.sky) { const U = s.material.uniforms; const ss = name === 'sunset';
    U.turbidity.value = ss ? 7.5 : 4.4; U.rayleigh.value = ss ? 2.4 : 1.35; U.mieCoefficient.value = ss ? 0.007 : 0.0045; U.mieDirectionalG.value = ss ? 0.86 : 0.8; }
  // sun light from the solar model: direction, a warmer / weaker colour as it gets low, sky + atmosphere uniforms
  placeSun() {
    const d = sunDir(this.hour, this._sd || (this._sd = new THREE.Vector3())); this.sunDirV = d; const el = Math.max(-0.05, d.y);
    this.sunOff = (this.sunOff && this.sunOff !== this._sunOffT ? this.sunOff : (this.sunOff = new THREE.Vector3())).copy(d).multiplyScalar(300); if (d.y < 0.08) this.sunOff.y = Math.max(this.sunOff.y, 0.08 * 300); // keep shadows sane at the horizon
    if (this.sky) this.sky.material.uniforms.sunPosition.value.copy(d);
    const warm = 1 - THREE.MathUtils.smoothstep(el, 0.03, 0.35); const B = this.sunBase; if (!B) return;
    this.sun.color.copy(B.col).lerp(this._warmC || (this._warmC = new THREE.Color(0xff9a52)), warm * 0.8); this.sun.intensity = B.I * (0.35 + 0.65 * THREE.MathUtils.smoothstep(el, -0.02, 0.3)) * (this.tod === 'sunset' ? 1 : 1);
    this.hemi.intensity = B.hemiI * (0.55 + 0.45 * THREE.MathUtils.smoothstep(el, -0.05, 0.4));
  }
  makeSkyEnv(name) {
    const key = name + '_sky_' + this.hour.toFixed(2); this.envCache = this.envCache || {}; if (this.envCache[key]) return this.envCache[key];
    for (const k in this.envCache) if (k.includes('_sky_')) { this.envCache[k].dispose?.(); delete this.envCache[k]; } // only the current sun position is kept
    const sky = this.newSky(); this.skyParams(name, sky); sky.material.uniforms.sunPosition.value.copy(sunDir(this.hour)); sky.scale.setScalar(80); this.envHour = this.hour;
    return (this.envCache[key] = this.makeCityEnv(name, false, null, null, new THREE.Color(TOD[name].gnd), sky, key));
  }
  // Night lighting (Medium / High only; Low keeps its cost): real light from the player's headlights (one spot light
  // with a soft edge) and a small pool of warm point lights that follow the street lamps nearest the car.
  nightLights(on) {
    // Lights are created once and never hidden (a change in the number of visible lights recompiles every material's
    // shader); unused ones just sit at intensity 0. Units are physical (candela, three r160): a real low-beam is several
    // thousand cd, so the old 45 cd spot / 28 cd lamps lit the road below the tone-mapped noise floor (nothing visible).
    const g = this.s.graphics, n = MOB || g.preset === 'adaptive' || g.resAuto ? 2 : g.envDetail >= 2 ? 6 : g.envDetail >= 1 ? 4 : 0; // Adaptive: 2 real lamp lights (the baked lamp pools light the rest)
    if (!this.lampPool && n && on) { this.lampPool = []; for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffb866, 0, 30, 1.7); this.scene.add(l); this.lampPool.push(l); } }
    if (!this.headSpot && n && on) { const sp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.8, 1.6); this.headSpot = sp; this.scene.add(sp, sp.target); }
    this.lightsOn = !!(on && n); this.lampT = 0;
    this.lampI = this.lightsOn && this.night ? 150 : 0; // street lamps only at night (a wet day keeps them off)
    this.headI = (this.lightsOn ? (this.night ? 1700 : 600) : 0) * (g.envDetail >= 2 ? 0.45 : 1); // the beam meets the road at a few degrees, so it needs real-headlight candela; High/Ultra (GTAO + grade + bloom) over-expose the pool at full strength
    if (this.lampPool) for (const l of this.lampPool) l.intensity = this.lampI;
    if (this.headSpot) this.headSpot.intensity = this.headI;
  }
  updateNightLights(car, world, dt, headOn) { // call once per frame with the player's car object
    if (!this.lightsOn || !car) return;
    const sp = this.headSpot; if (sp) { const yaw = car.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      sp.intensity = headOn ? this.headI : 0; sp.position.set(car.position.x + fx * 2.1, car.position.y + 0.7, car.position.z + fz * 2.1);
      sp.target.position.set(car.position.x + fx * 26, car.position.y - 0.6, car.position.z + fz * 26); sp.target.position.y = car.position.y - 2.2; sp.target.updateMatrixWorld(); } // dipped beam: lights the road, not the walls ahead
    this.lampT -= dt; const L = world?.lampSpots; if (!L || !this.lampPool || this.lampT > 0) return; this.lampT = 0.3;
    const x = car.position.x, z = car.position.z, best = [];
    for (const l of L) { const d = (l[0] - x) ** 2 + (l[1] - z) ** 2; if (d > 10000) continue; best.push([d, l]); }
    best.sort((a, b) => a[0] - b[0]);
    this.lampPool.forEach((pl, i) => { const b = best[i]; if (!b) { pl.intensity = 0; return; } pl.intensity = this.lampI; pl.position.set(b[1][0], 7.5, b[1][1]); });
  }
  makeCityEnv(name, rain, zen, hor, gnd, skyObj = null, skyKey = null) {
    const key = skyKey || name + (rain ? 'r' : ''); this.envCache = this.envCache || {}; if (!skyObj && this.envCache[key]) return this.envCache[key];
    const sc = new THREE.Scene(); if (skyObj) { hor = new THREE.Color(TOD[name].hor); zen = new THREE.Color(TOD[name].zen); const gd = new THREE.Mesh(new THREE.CircleGeometry(60, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: gnd })); gd.position.y = -2; sc.add(skyObj, gd); }
    const sky = skyObj ? new THREE.Object3D() : new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { zen: { value: zen }, hor: { value: hor }, gnd: { value: gnd } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 zen; uniform vec3 hor; uniform vec3 gnd; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.5)) : mix(hor * 0.5, gnd, clamp(-h * 6.0, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }' }));
    sc.add(sky);
    // skyline ring: dark blocks (with lit windows at night) so reflections break up like a street, not a studio
    const night = name === 'night'; let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const bm = new THREE.MeshBasicMaterial({ color: night ? 0x07080b : new THREE.Color(hor).multiplyScalar(0.35) });
    const wm = new THREE.MeshBasicMaterial({ color: night ? 0xffc47a : new THREE.Color(hor).multiplyScalar(0.8) });
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2 + rnd() * 0.1, h = 3 + rnd() * 14, w = 4 + rnd() * 6; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), bm); b.position.set(Math.cos(a) * 30, h / 2 - 2, Math.sin(a) * 30); b.lookAt(0, h / 2 - 2, 0); sc.add(b);
      if (night || rnd() < 0.5) for (let k = 0; k < 4; k++) { const wdw = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.25), wm); wdw.position.copy(b.position).multiplyScalar(0.94); wdw.position.y = 1 + k * h / 5; wdw.lookAt(0, wdw.position.y, 0); sc.add(wdw); } }
    if (!rain && !night && !skyObj) { const sun = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(name === 'sunset' ? 0xffb070 : 0xfff6e0).multiplyScalar(name === 'sunset' ? 6 : 12) })); const sp = new THREE.Vector3(...TOD[name].sunPos).normalize().multiplyScalar(42); sun.position.copy(sp); sc.add(sun); }
    if (night) for (let i = 0; i < 14; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc98a).multiplyScalar(5) })); const a = rnd() * 6.3; l.position.set(Math.cos(a) * 20, 6, Math.sin(a) * 20); sc.add(l); }
    const pm = new THREE.PMREMGenerator(this.r); const tex = pm.fromScene(sc, 0.02).texture; pm.dispose();
    sc.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    return (this.envCache[key] = tex);
  }
  makeRain() {
    const n = 3500, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60; pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45, fog: false })); this.rain.frustumCulled = false; this.scene.add(this.rain);
  }
  follow(target) { // keep sun shadow frustum and rain around the player
    if (this.sunOff) {
      // stable shadow frustum: the centre is snapped to the shadow-map texel grid IN LIGHT SPACE (the basis the shadow
      // camera's lookAt builds: x = up × toSun, y = toSun × x), so static edges never swim and the map is re-drawn every
      // frame with the car where it really is (no lag, no blink)
      if (!this._noShadowUpd) {
        const f = this._sf || (this._sf = new THREE.Vector3()), u = this._su || (this._su = new THREE.Vector3()), v = this._sv || (this._sv = new THREE.Vector3());
        f.copy(this.sunOff).normalize(); u.set(0, 1, 0).cross(f); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); else u.normalize(); v.crossVectors(f, u);
        const q = 2 * this.shExt / this.sun.shadow.mapSize.x, a = Math.round(target.dot(u) / q) * q, b2 = Math.round(target.dot(v) / q) * q, c = target.dot(f);
        this._shC.set(0, 0, 0).addScaledVector(u, a).addScaledVector(v, b2).addScaledVector(f, c);
        this.sun.position.copy(this._shC).add(this.sunOff); this.sun.target.position.copy(this._shC); this.sun.shadow.needsUpdate = true;
      }
    }
    if (this.rain?.visible) { this.rain.position.set(this.cam.position.x, this.cam.position.y - 5, this.cam.position.z); this.rain.position.y -= (performance.now() / 1000 * 25) % 10; }
  }
  // per-frame: dynamic time of day, sky follows the camera, atmosphere uniforms, fog glow toward the sun (Low/Medium)
  frameFx(dt) {
    const g = this.s.graphics, cam = this.cam; dt = Math.min(dt || 0, 0.1); this.fxT = (this.fxT || 0) + dt;
    if (this.physSky) { if (this.dynTOD !== false && this.hour < this.hour0 + (TOD_DRIFT[this.tod] || 0)) { this.hour += dt / 720; this.placeSun();
        if (Math.abs(this.hour - (this.envHour ?? this.hour)) > 0.25) { this.cityEnv = this.makeSkyEnv(this.tod); if (g.reflections >= 1) this.scene.environment = this.cityEnv; if (g.reflections >= 1 && !this.cube) setCarEnv(this.cityEnv); } }
      this.sky.position.copy(cam.position); }
    const sd = this.physSky ? this.sunDirV : (this._sd0 || (this._sd0 = new THREE.Vector3())).copy(this.sunOff || new THREE.Vector3(0, 1, 0)).normalize();
    const fwd = this._fw || (this._fw = new THREE.Vector3()); cam.getWorldDirection(fwd); const mu = fwd.dot(sd);
    if (!this.atmos && this.fogBase && !this.night && !this.rainOn) { const k = Math.pow(Math.max(0, mu), 6) * (this.tod === 'sunset' ? 0.35 : 0.2); this.scene.fog.color.copy(this.fogBase).lerp(this.sun.color, k); }
    for (const f of this.updaters || []) f(dt, cam);
    const A = this.atmos; if (!A) return; const U = A.uniforms;
    U.projInv.value.copy(cam.projectionMatrixInverse); U.viewInv.value.copy(cam.matrixWorld); U.viewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    U.camPos.value.copy(cam.position); U.sunDir.value.copy(sd); U.haze.value = this.scene.fog.density; U.aspect.value = cam.aspect; U.time.value = this.fxT % 100;
    const vis = !this.night && !this.rainOn && sd.y > -0.03; U.sunCol.value.copy(this.sun.color).multiplyScalar(vis ? this.sun.intensity * 0.45 : 0);
    U.scatter.value = this.night ? 0 : this.rainOn ? 0.3 : this.tod === 'sunset' ? 1.6 : 1.0; U.wet.value = this.rainOn ? 1 : 0;
    const sp = this._sp || (this._sp = new THREE.Vector3()); sp.copy(cam.position).addScaledVector(sd, 1000).project(cam);
    const on = vis && mu > 0 && Math.abs(sp.x) < 1.6 && Math.abs(sp.y) < 1.6; U.sunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5); U.sunOn.value = on ? THREE.MathUtils.smoothstep(mu, 0.1, 0.6) : 0;
    U.rays.value = this.tod === 'sunset' ? 0.55 : 0.32; U.flare.value = 0.06;
    if (this.grade) this.grade.uniforms.time.value = this.fxT % 10;
  }
  render(dt, carPos, hideForProbe) {
    const PF = globalThis.CZPROF; let pt = PF?.on ? performance.now() : 0;
    this.frameFx(dt); if (pt) { const t = performance.now(); PF.acc['gfx.fx+streetlife'] = (PF.acc['gfx.fx+streetlife'] || 0) + t - pt; pt = t; }
    // live probe: cubeFacesPer faces per frame (desktop High/Ultra: all six, phones: 3, Medium: 2). The probe renders run
    // with the renderer-level shadow update OFF: they reuse last frame's map. The map is drawn by the first render of the
    // main view, with the player's car visible (it used to be drawn inside the probe face render, where the car is hidden
    // -> the car's shadow vanished for the frames until the next redraw = the blinking shadow)
    if (this.r.xr?.isPresenting) { this.r.shadowMap.needsUpdate = true; this.r.render(this.scene, this.cam); this.fc++; return; } // p52 VR: straight to the XR layer (MSAA + foveation), no post chain / probe
    this.r.shadowMap.needsUpdate = false;
    if (this.cube && carPos && (++this.cubeN % this.cubeEvery === 0)) { const h = hideForProbe, sl = this.probeHide; if (h) h.visible = false; const slv = sl?.visible; if (sl) sl.visible = false; // parked cars / pedestrians are left out of the probe
      const far = !this._cubeInit || this.cube.position.distanceToSquared(carPos) > 900; // first use / teleport / showroom→world: refresh all six faces so no stale seam
      if (far) { this._cubeInit = true; this.cube.position.set(carPos.x, carPos.y + 0.9, carPos.z); for (let f = 0; f < 6; f++) this.cubeFaceUpdate(f); this.cubeFace = 5; }
      else for (let k = 0; k < (this.cubeFacesPer || 1); k++) { if (this.cubeFace === 0) this.cube.position.set(carPos.x, carPos.y + 0.9, carPos.z); this.cubeFaceUpdate(this.cubeFace);
        if (this.cubeFace === 5) this.cubeRT.texture.needsPMREMUpdate = true; // full turn: re-filter (roughness-correct blur mips)
        this.cubeFace = (this.cubeFace + 1) % 6; }
      if (far) { this.cubeRT.texture.needsPMREMUpdate = true; this.cubeFace = 0; }
      if (h) h.visible = true; if (sl) sl.visible = slv;
      if (pt) { const t = performance.now(); PF.acc['gfx.cubeFace'] = (PF.acc['gfx.cubeFace'] || 0) + t - pt; pt = t; } }
    this.r.shadowMap.needsUpdate = true; // renderer-level: the first main-view render draws the shadow map, later ones (GTAO normals, transmission) reuse it
    if (this.composer) this.composer.render(dt); else this.r.render(this.scene, this.cam);
    if (pt) PF.acc['gfx.draw(submit)'] = (PF.acc['gfx.draw(submit)'] || 0) + performance.now() - pt;
    this.fc++;
  }
  cubeFaceUpdate(i) { // CubeCamera.update for a single face
    const cc = this.cube, r = this.r, rt = this.cubeRT; if (cc.parent === null) cc.updateMatrixWorld(); else cc.updateMatrixWorld(true);
    if (cc.coordinateSystem !== r.coordinateSystem) { cc.coordinateSystem = r.coordinateSystem; cc.updateCoordinateSystem(); }
    const cur = r.getRenderTarget(), cf = r.getActiveCubeFace(), cm = r.getActiveMipmapLevel();
    r.setRenderTarget(rt, i); r.render(this.scene, cc.children[i]); r.setRenderTarget(cur, cf, cm);
  }
  // every rAF callback (drawn or skipped by the limiter): display refresh rate = median rAF interval over ~2 s
  rafTick(t) { if (this.rafT) { const d = t - this.rafT; if (d > 2 && d < 100) { this.rafD.push(d); if (this.rafD.length >= 120) { const s = this.rafD.sort((a, b) => a - b); const hz = 1000 / s[s.length >> 1]; this.displayHz = hz > 105 ? 120 : hz > 80 ? 90 : 60; this.stat.hz = Math.round(hz); this.rafD = []; } } } this.rafT = t; }
  // every drawn frame: t = rAF time, cpu = main-thread ms spent in tick (update + render submission)
  frameDone(t, cpu) {
    const d = this.lastDrawT ? t - this.lastDrawT : 0; this.lastDrawT = t; this.frames++;
    if (d > 0 && d < 1000) { this.ft[this.ftI] = d; this.ftI = (this.ftI + 1) % this.ft.length; this.ftN = Math.min(this.ft.length, this.ftN + 1); this.secMs += d; this.secN++; this.secCpu += cpu; }
    if (t - this.fpsT >= 1000) { const el = t - this.fpsT; this.fps = this.frames * 1000 / el; this.frames = 0; this.fpsT = t; this.fpsHist.push(this.fps); if (this.fpsHist.length > 30) this.fpsHist.shift();
      const S = this.stat; S.fps = this.fps; S.ms = this.secN ? this.secMs / this.secN : 0; S.cpu = this.secN ? this.secCpu / this.secN : 0; this.secMs = this.secN = this.secCpu = 0;
      const n = Math.min(this.ftN, 600); if (n >= 20) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = this.ft[(this.ftI - 1 - i + this.ft.length) % this.ft.length]; a.sort(); S.low1 = 1000 / a[Math.min(n - 1, Math.floor(n * 0.99))]; } else S.low1 = S.fps; }
    if (d > 0 && d < 250) this.dynRes(t, d, cpu);
  }
  // dynamic resolution (Ultra Adaptive / Auto resolution): smoothed frame time against the target budget, one small step
  // at most every 2 s, never while the main thread (not the GPU) is the bottleneck, and a step up that had to be undone
  // blocks further step-ups for 20 s (no oscillation / flicker)
  dynRes(t, d, cpu) {
    const g = this.s.graphics; if (!g.resAuto) { this.dynScale = 1; return; }
    const a = this.dynEma ? 0.06 : 1; this.dynEma += (d - this.dynEma) * a; this.dynCpu += (cpu - this.dynCpu) * a;
    if (t - this.dynT < 2000) return; this.dynT = t;
    const budget = 1000 / Math.min(g.fps || 60, this.displayHz || 60); let s = this.dynScale;
    if (this.dynEma > budget * 1.12 && this.dynCpu < this.dynEma * 0.75) { s -= this.dynEma > budget * 1.5 ? 0.1 : 0.05; if (t - this.dynUpAt < 6000) this.dynBlock = t + 20000; }
    else if (this.dynEma < budget * 1.04 && t > this.dynBlock && s < 1) { s += 0.05; this.dynUpAt = t; }
    s = Math.round(Math.max(0.5, Math.min(1, s)) * 100) / 100; if (s !== this.dynScale) { this.dynScale = s; this.resize(); }
  }
  measured() { const h = this.fpsHist.slice(-10); return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0; }
}
