import { Box3, Group, InstancedMesh, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();

function fitModel(model, targetHeight, targetWidth) {
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const scale = Math.min(targetHeight / Math.max(size.y, 0.01), targetWidth / Math.max(size.x, 0.01));
  model.scale.setScalar(scale);
  box.setFromObject(model);
  const center = box.getCenter(new Vector3());
  const floor = box.min.y;
  model.position.set(-center.x, -floor, -center.z);
}

function configureModel(model, castsShadow) {
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = castsShadow;
      node.receiveShadow = castsShadow;
    }
  });
}

function setProceduralCarVisible(car, visible) {
  car.mesh.children.forEach((child) => {
    // Always keep the dedicated brake light rig visible so brake lights glow on 3D car model
    if (child.name === 'brake-light-rig') return;
    child.visible = visible;
  });
}

function setProceduralTreesVisible(scenery, visible) {
  scenery.children
    .filter((child) => child.name === 'tree-trunks' || child.name === 'tree-foliage')
    .forEach((child) => { child.visible = visible; });
}

function isSafeTreePosition(position, track, minDistanceToRoad = 18.5) {
  const minSq = minDistanceToRoad * minDistanceToRoad;
  const samples = track.samples;
  const count = samples.length;
  // Test candidate position against all track sample points to ensure no overlap on any curve/hairpin
  for (let i = 0; i < count; i += 2) {
    const sp = samples[i].position;
    const dx = sp.x - position.x;
    const dz = sp.z - position.z;
    if (dx * dx + dz * dz < minSq) {
      return false;
    }
  }
  return true;
}

function addInstancedTrees(source, track, scenery) {
  const byMaterial = new Map();
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    if (!node.isMesh || Array.isArray(node.material)) return;
    const parts = byMaterial.get(node.material.uuid) ?? { material: node.material, geometries: [] };
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    parts.geometries.push(geometry);
    byMaterial.set(node.material.uuid, parts);
  });

  const targetCount = 240;
  const trees = new Group();
  trees.name = 'model-trees';
  const random = (() => {
    let state = 0x7a3e91;
    return () => { state ^= state << 13; state >>>= 0; state ^= state >> 17; state ^= state << 5; state >>>= 0; return state / 0xffffffff; };
  })();
  const matrices = [];
  const position = new Vector3();
  const scale = new Vector3();
  const matrix = new Matrix4();

  let attempts = 0;
  while (matrices.length < targetCount && attempts < targetCount * 12) {
    attempts++;
    const sample = track.samples[(random() * track.samples.length) | 0];
    const side = random() < 0.5 ? -1 : 1;
    // Spread trees starting just past the barrier out across the entire verge
    track.groundPoint(sample, side * (track.wallLateral + 4 + random() * 48), position);

    if (!isSafeTreePosition(position, track, 18.5)) {
      continue;
    }

    const size = 1.0 + random() * 0.85;
    scale.setScalar(size);
    matrix.makeRotationY(random() * Math.PI * 2);
    matrix.scale(scale);
    matrix.setPosition(position);
    matrices.push(matrix.clone());
  }

  const treeCount = matrices.length;

  for (const { material, geometries } of byMaterial.values()) {
    const geometry = mergeGeometries(geometries, false);
    // Dispose intermediate cloned geometries to free memory
    for (const g of geometries) g.dispose();
    if (!geometry) continue;

    geometry.computeBoundingSphere();
    const instances = new InstancedMesh(geometry, material, treeCount);
    instances.castShadow = true;
    instances.receiveShadow = false;
    for (let index = 0; index < treeCount; index++) instances.setMatrixAt(index, matrices[index]);
    instances.instanceMatrix.needsUpdate = true;
    trees.add(instances);
  }
  scenery.add(trees);
}

export async function loadModelAssets(track, car, scenery) {
  // Keep the loading overlay up instead of showing procedural placeholders and
  // swapping them later. Restore the fallback only if a supplied asset fails.
  setProceduralCarVisible(car, false);
  setProceduralTreesVisible(scenery, false);

  const carTask = loader.loadAsync('/models/car.glb').then((gltf) => {
    const model = gltf.scene;
    fitModel(model, 1.28, 2.1);
    model.rotation.y = Math.PI;
    configureModel(model, true);
    car.mesh.add(model);
  }).catch((error) => {
    console.warn('Could not load car model:', error);
    setProceduralCarVisible(car, true);
  });

  const treeTask = loader.loadAsync('/models/tree.glb').then((gltf) => {
    const source = gltf.scene;
    fitModel(source, 26.0, 20.0);
    configureModel(source, false);
    addInstancedTrees(source, track, scenery);
  }).catch((error) => {
    console.warn('Could not load tree model:', error);
    setProceduralTreesVisible(scenery, true);
  });

  await Promise.all([carTask, treeTask]);
}
