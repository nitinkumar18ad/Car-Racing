import {
  Box3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function setProceduralCarVisible(car, visible) {
  car.mesh.children.forEach((child) => {
    if (child.name === 'real-car-model') return;
    child.visible = visible;
  });
}

export async function loadModelAssets(track, car, scenery) {
  // Hide boxy primitives upfront
  setProceduralCarVisible(car, false);

  try {
    const gltf = await loader.loadAsync('/models/car.glb');
    const model = gltf.scene;

    const carWrapper = new Group();
    carWrapper.name = 'real-car-model';

    // 1. Orient model to face local -Z (standard three.js forward direction)
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);

    // 2. Uniform scale to match realistic GT/sports race car proportions
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());

    const targetWidth = 1.98;
    const targetLength = 4.38;
    const targetHeight = 1.12;

    const scale = Math.min(
      targetWidth / Math.max(size.x, 0.01),
      targetLength / Math.max(size.z, 0.01),
      targetHeight / Math.max(size.y, 0.01),
    );
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    // 3. Ground the wheels flush with the road (floor at y = 0) and center along X and Z
    box.setFromObject(model);
    const center = box.getCenter(new Vector3());
    const floor = box.min.y;

    model.position.set(-center.x, -floor, -center.z);

    // 4. Configure photorealistic shaders, clearcoat metallic paint, and crisp shadows
    model.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;

        if (node.material) {
          const mat = node.material;
          mat.roughness = Math.min(mat.roughness != null ? mat.roughness : 0.4, 0.32);
          mat.metalness = Math.max(mat.metalness != null ? mat.metalness : 0.2, 0.55);
          mat.envMapIntensity = 1.35;
          mat.needsUpdate = true;
        }
      }
    });

    carWrapper.add(model);

    // 5. Add taillight brake glow rig on rear haunches
    const brakeRig = new Group();
    brakeRig.name = 'brake-light-rig';
    const lensGeom = new CylinderGeometry(0.09, 0.09, 0.05, 14);
    lensGeom.rotateX(Math.PI / 2);

    const brakeMat = new MeshStandardMaterial({
      color: 0x99000a,
      emissive: 0xff1822,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.2,
    });

    // Positions matching the Jaguar XJ13 rear round taillights
    const leftLight = new Mesh(lensGeom, brakeMat);
    leftLight.position.set(-0.64, 0.56, 2.08);
    const rightLight = new Mesh(lensGeom, brakeMat);
    rightLight.position.set(0.64, 0.56, 2.08);

    brakeRig.add(leftLight, rightLight);
    carWrapper.add(brakeRig);

    // Register with car brake lights so updateVisuals dynamically glows under braking
    if (car.brakeLights) {
      car.brakeLights.push(leftLight, rightLight);
    }

    car.mesh.add(carWrapper);
    console.log('Photorealistic 3D car model successfully loaded.');
  } catch (error) {
    console.warn('Failed to load 3D car model, falling back to procedural car:', error);
    setProceduralCarVisible(car, true);
  }
}
