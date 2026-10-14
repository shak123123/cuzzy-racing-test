// NaN / Inf safety for every built-in three.js material and for the post passes (black-spot fix).
//
// Root cause of the black spots on High / Ultra / Adaptive: those presets render the scene into a HalfFloat (RGBA16F)
// target for the post chain. Mirror-smooth surfaces (clearcoat 0.005-0.025, chrome / gold paints 0.035-0.05, glass 0.015-0.02,
// wet road, glazing) give a GGX sun highlight of 1/(pi*a^2) ~ 4e4 x sun irradiance, i.e. > 65504 = +Inf once stored
// in half float. OutputPass then tone-maps Inf (ACES: Inf/Inf = NaN), and the old guards turned every non-finite pixel
// into BLACK - so the very brightest sparkles became black dots / blocks (and bloom / transmission mips spread them).
// Low / Medium draw straight to the 8-bit canvas, where the same value just clips to white - hence "only High+".
// Other genuine NaN sources: GTAO acos()/sqrt() of |cos| slightly > 1 and normalize(0) (clamp(NaN) is 0 on Adreno/Mali
// -> AO = 0 -> black), glass fresnel pow(1 - |n.v|, 5) with |n.v| a hair above 1 (NaN alpha -> NaN blend).
//
// Fix: every material writes a finite, clamped colour (max 30000, well inside half float, far above anything the tone
// map can tell apart) and a finite alpha; NaN components become 0 (not whole-pixel black); the post passes clamp Inf to
// bright instead of black and repair any remaining NaN pixel from its neighbours.
import * as THREE from 'three';

const SAFE_FN = `
#ifndef CZ_SAFE
#define CZ_SAFE
vec3 czSafe3( vec3 c ) {
#if __VERSION__ >= 300
  c = mix( c, vec3( 0.0 ), isnan( c ) ); // bvec overload = per-component select (a float mix would keep NaN*0 = NaN)
#else
  c = vec3( c.r == c.r ? c.r : 0.0, c.g == c.g ? c.g : 0.0, c.b == c.b ? c.b : 0.0 );
#endif
  return clamp( c, 0.0, 30000.0 );
}
bool czIsNan3( vec3 c ) {
#if __VERSION__ >= 300
  return any( isnan( c ) );
#else
  return !( c.r == c.r ) || !( c.g == c.g ) || !( c.b == c.b );
#endif
}
vec3 czNrm( vec3 v, vec3 f ) { float l = dot( v, v ); return l > 1e-12 ? v * inversesqrt( l ) : f; } // normalize(0) = NaN; also NaN in -> fallback
float czSafe1( float a, float d ) {
#if __VERSION__ >= 300
  if ( isnan( a ) ) return d;
#else
  if ( a != a ) return d;
#endif
  return clamp( a, 0.0, 1.0 );
}
#endif
`;
let installed = false;
export function installShaderSafety() {
  if (installed) return; installed = true; const C = THREE.ShaderChunk;
  C.common = C.common + SAFE_FN;
  // lit colour into the (HDR) target: finite and <= 30000 (custom code that runs right after this include sees sane values)
  C.opaque_fragment = C.opaque_fragment.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', 'gl_FragColor = vec4( czSafe3( outgoingLight ), czSafe1( diffuseColor.a, 1.0 ) );');
  // fog is the last colour change in every built-in shader (after any onBeforeCompile code appended to opaque_fragment,
  // e.g. the glass fresnel alpha): sanitise again, colour and alpha
  // (inline, no helper: MeshNormalMaterial - used by GTAO - includes these chunks without <common>)
  // degenerate normals (zero-area / collapsed triangles, zero-scale instances, collapsed tangent frames) -> NaN lighting
  C.normal_fragment_begin = C.normal_fragment_begin.replace('vec3 normal = normalize( cross( fdx, fdy ) );', 'vec3 normal = cross( fdx, fdy ); normal = dot( normal, normal ) > 1e-24 ? normalize( normal ) : vec3( 0.0, 0.0, 1.0 );')
    .replace('vec3 normal = normalize( vNormal );', 'vec3 normal = dot( vNormal, vNormal ) > 1e-12 ? normalize( vNormal ) : vec3( 0.0, 0.0, 1.0 );');
  C.normal_fragment_maps = C.normal_fragment_maps.replace('normal = normalize( tbn * mapN );', '{ vec3 czN = tbn * mapN; normal = dot( czN, czN ) > 1e-12 ? normalize( czN ) : normal; }');
  C.fog_fragment = C.fog_fragment + '\ngl_FragColor.rgb = czSafe3( gl_FragColor.rgb ); gl_FragColor.a = czSafe1( gl_FragColor.a, 1.0 );\n';
}

// post passes: czSafe3 (Inf -> 30000, NaN -> 0 per component) is prepended to their fragment shaders
export const withSafe = src => src.includes('precision highp float;') ? src.replace('precision highp float;', 'precision highp float;\n' + SAFE_FN) : SAFE_FN + src;

// GTAO: clamp the horizon cosines (acos / sqrt of |x| > 1 = NaN) and treat a non-finite AO as "no occlusion" (1.0)
// instead of letting clamp(NaN) give 0 (= black). Blend: same guard on the denoised AO texel.
export function patchGTAO(pass) {
  const m = pass.gtaoMaterial; if (m && !m.userData.czSafe) {
    m.fragmentShader = withSafe(m.fragmentShader
      .replace('vec2 sinHorizons = sqrt(1. - cosHorizons * cosHorizons);', 'cosHorizons = clamp(cosHorizons, -1., 1.); vec2 sinHorizons = sqrt(max(vec2(0.), 1. - cosHorizons * cosHorizons));')
      .replace('ao = clamp(ao / float(DIRECTIONS), 0., 1.);', 'ao = czSafe1(ao / float(DIRECTIONS), 1.0);'));
    m.userData.czSafe = 1; m.needsUpdate = true; }
  const bm = pass.blendMaterial; if (bm && !bm.userData.czSafe) {
    bm.fragmentShader = withSafe(bm.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = czIsNan3( texel.rgb ) ? vec3( 1.0 ) : clamp( texel.rgb, 0.0, 1.0 );'));
    bm.userData.czSafe = 1; bm.needsUpdate = true; }
}

// OutputPass (RawShaderMaterial, GLSL 1 or 3): tone mapping of finite HDR input; a NaN that still reaches it is repaired
// from the 4 neighbours (uniform czPx = 1 / target size) instead of being painted black
export function patchOutput(op) {
  const m = op.material; m.uniforms.czPx = { value: new THREE.Vector2(1 / 1024, 1 / 1024) };
  m.fragmentShader = withSafe(m.fragmentShader.replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform vec2 czPx;')
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
    if ( czIsNan3( gl_FragColor.rgb ) ) {
      vec3 s = vec3( 0.0 ); float n = 0.0; vec3 c;
      c = texture2D( tDiffuse, vUv + vec2( czPx.x, 0.0 ) * 2.0 ).rgb; if ( !czIsNan3( c ) ) { s += czSafe3( c ); n += 1.0; }
      c = texture2D( tDiffuse, vUv - vec2( czPx.x, 0.0 ) * 2.0 ).rgb; if ( !czIsNan3( c ) ) { s += czSafe3( c ); n += 1.0; }
      c = texture2D( tDiffuse, vUv + vec2( 0.0, czPx.y ) * 2.0 ).rgb; if ( !czIsNan3( c ) ) { s += czSafe3( c ); n += 1.0; }
      c = texture2D( tDiffuse, vUv - vec2( 0.0, czPx.y ) * 2.0 ).rgb; if ( !czIsNan3( c ) ) { s += czSafe3( c ); n += 1.0; }
      gl_FragColor.rgb = n > 0.0 ? s / n : vec3( 0.0 );
    }
    gl_FragColor.rgb = czSafe3( gl_FragColor.rgb ); gl_FragColor.a = czSafe1( gl_FragColor.a, 1.0 );`));
  m.needsUpdate = true;
}
