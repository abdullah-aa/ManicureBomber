import { Scene, Vector3, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Color3 } from '@babylonjs/core';

// Unit vector from any observer toward the sun: elevation atan(1/1.5*sqrt(2)) ~= 25deg,
// azimuth 45deg between +x/+z (same azimuth as the old (-1,-1,-1) light). Low enough
// to enter the chase camera's frame with a small downward drag, but the disc's lower
// halo edge (~18deg) must stay above any ray a cloud could occupy beyond SUN_DISTANCE
// (needs cloud y >= camera.y + 307; cloud tops are ~250) or the opaque bake would
// punch a sky-colored hole through it — don't lower this much further.
// Game.setupLighting derives the DirectionalLight direction from this (negated)
// so the visible disc and the shading always agree.
export const SUN_DIRECTION = new Vector3(1.5, 1, 1.5).normalize();

// View-space depth of the disc: beyond every cloud (band y 175-225, always much
// nearer than 1000 along the sun direction) so opaque clouds depth-occlude it,
// and inside camera.maxZ (1700).
const SUN_DISTANCE = 1000;
// Halo spans ~14deg of sky; the pale core is the inner 30% (~4.3deg).
const SUN_PLANE_SIZE = 250;

/**
 * A pale sun: one camera-locked plane with a radial core+halo gradient baked
 * over the sky color. The texture is OPAQUE on purpose — particle systems render
 * before transparent meshes within a rendering group, so an alpha-blended sun
 * would composite on top of explosion/exhaust smoke. Opaque costs nothing to
 * sort, particles overlay it correctly, and the baked sky-colored edges are
 * invisible against the real sky because nothing can ever be behind the disc
 * (it spans elevations ~18-32deg; a cloud behind it would need y >= camera.y + 307,
 * and cloud tops are ~250).
 */
export function createSun(scene: Scene): Mesh {
  const texSize = 256;
  const texture = new DynamicTexture('sunTexture', texSize, scene, false);
  const ctx = texture.getContext();
  const half = texSize / 2;
  // Must equal scene.clearColor (0.5, 0.7, 0.9) = rgb(128, 179, 230) — if the sky
  // color in TerrainManager.createClearSky ever changes, change this with it.
  ctx.fillStyle = 'rgb(128, 179, 230)';
  ctx.fillRect(0, 0, texSize, texSize);
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, 'rgba(255, 249, 234, 0.95)'); // pale warm core
  gradient.addColorStop(0.3, 'rgba(255, 249, 234, 0.92)'); // core disc edge
  gradient.addColorStop(0.38, 'rgba(253, 244, 222, 0.42)'); // soft rim
  gradient.addColorStop(0.62, 'rgba(248, 240, 220, 0.16)'); // inner halo
  gradient.addColorStop(0.85, 'rgba(244, 238, 220, 0)'); // fully sky before the edge
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, texSize, texSize);
  texture.update();

  // Unlit texture (ground-crosshair pattern): with lighting disabled the shader
  // multiplies the white emissive by the diffuse texture, rendering it as-authored.
  const material = new StandardMaterial('sunMaterial', scene);
  material.diffuseTexture = texture;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.fogEnabled = false; // sits past fogStart (900); must not be fog-washed
  material.freeze();

  const sun = MeshBuilder.CreatePlane('sun', { size: SUN_PLANE_SIZE }, scene);
  sun.material = material;
  sun.isPickable = false;
  sun.applyFog = false;
  // World translation becomes camera.position + this.position every frame, so the
  // sun never gets closer or farther no matter where the streamed world goes.
  // (Do NOT freezeWorldMatrix — that would stop the camera-follow.)
  sun.infiniteDistance = true;
  sun.position.copyFrom(SUN_DIRECTION).scaleInPlace(SUN_DISTANCE);
  // Direction to the sun is constant for every camera pose (infiniteDistance), so
  // one static orientation replaces billboarding: +z away from the viewer puts the
  // plane's front face (-z normal) looking back at the camera.
  sun.lookAt(sun.position.scale(2));
  return sun;
}
