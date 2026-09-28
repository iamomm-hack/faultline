import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { evidence } from '../protocol/model';

/** Demand-rendered geometry: no animation loop and no time-driven rotation. */
export default function GuardScene({ progress }: { progress: number }) {
  const host = useRef<HTMLDivElement>(null);
  const draw = useRef<((p: number) => void) | null>(null);
  const latest = useRef(progress);
  useEffect(() => {
    latest.current = progress;
    draw.current?.(progress);
  }, [progress]);
  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x080808, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080808);
    scene.fog = new THREE.Fog(0x080808, 12, 23);
    const studio = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environment = environmentGenerator.fromScene(studio, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    studio.dispose();
    environmentGenerator.dispose();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    camera.position.set(8, 5.8, 11);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(-3, 7, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 2);
    rim.position.set(5, 2, -4);
    scene.add(rim);
    const metal = new THREE.MeshStandardMaterial({
      color: 0x92928e,
      metalness: 0.65,
      roughness: 0.38,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x272727,
      metalness: 0.5,
      roughness: 0.5,
    });
    const pale = new THREE.MeshStandardMaterial({
      color: 0xdadad2,
      metalness: 0.4,
      roughness: 0.5,
    });
    const geometries: THREE.BufferGeometry[] = [];
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      material = metal,
      parent: THREE.Object3D = scene,
    ) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const gate = new THREE.Group();
    scene.add(gate);
    for (let i = 0; i < 5; i++) {
      const z = -i * 0.22;
      box(-1.48, 0, z, 0.28, 4.1, 0.16, i ? dark : metal, gate);
      box(1.48, 0, z, 0.28, 4.1, 0.16, i ? dark : metal, gate);
      box(0, 1.9, z, 3.15, 0.28, 0.16, metal, gate);
      box(0, -1.9, z, 3.15, 0.28, 0.16, metal, gate);
    }
    const doorL = box(-0.65, 0, -0.3, 1.23, 3.45, 0.09, dark, gate);
    const doorR = box(0.65, 0, -0.3, 1.23, 3.45, 0.09, dark, gate);
    const boltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8);
    geometries.push(boltGeometry);
    const bolts = new THREE.InstancedMesh(boltGeometry, pale, 12);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      dummy.position.set(
        i % 2 ? 1.48 : -1.48,
        -1.7 + Math.floor(i / 2) * 0.68,
        0.12,
      );
      dummy.rotation.x = Math.PI / 2;
      dummy.updateMatrix();
      bolts.setMatrixAt(i, dummy.matrix);
    }
    gate.add(bolts);
    const fragments = Array.from({ length: 12 }, (_, i) =>
      box(
        -1.8 + (i % 3) * 0.65,
        -0.8 + Math.floor(i / 3) * 0.46,
        2.5 + (i % 4) * 0.22,
        0.57,
        0.36,
        0.25,
        i % 3 ? metal : pale,
      ),
    );
    const byteGeometry = new THREE.BoxGeometry(1, 1, 1);
    geometries.push(byteGeometry);
    const byteStripes = new THREE.InstancedMesh(byteGeometry, dark, 96);
    const payload = evidence.replay_jobs[0].candidate_executable_sha256;
    const stripeTransform = new THREE.Object3D();
    const stripeMatrix = new THREE.Matrix4();
    scene.add(byteStripes);
    const core = box(0.1, 0, -2.4, 1.1, 1.3, 0.8, pale);
    const edgeGeometry = new THREE.EdgesGeometry(core.geometry);
    geometries.push(edgeGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    core.add(edges);
    const nodes = [-1, 0, 1].map((n) =>
      box(n * 2.3, 2.8, -0.8, 0.22, 0.22, 0.22, pale),
    );
    const lineGeometry = new THREE.BufferGeometry();
    geometries.push(lineGeometry);
    const positions = new Float32Array(18);
    lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x999999,
      transparent: true,
      opacity: 0.5,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);
    const floor = new THREE.GridHelper(12, 24, 0x252525, 0x141414);
    floor.position.y = -2.2;
    scene.add(floor);
    let visible = false;
    const render = (p: number) => {
      if (!visible || document.hidden || renderer.getContext().isContextLost())
        return;
      const align = THREE.MathUtils.smoothstep(p, 0.05, 0.28);
      const open = THREE.MathUtils.smoothstep(p, 0.72, 0.86);
      doorL.position.x = -0.65 - open * 1.28;
      doorR.position.x = 0.65 + open * 1.28;
      fragments.forEach((part, i) => {
        const unsafe = i >= 9;
        part.position.x = THREE.MathUtils.lerp(
          -1.8 + (i % 3) * 0.65,
          -0.65 + (i % 3) * 0.65,
          align,
        );
        part.position.z = 2.7 - align * 1.6 - (unsafe ? 0 : open * 3.8);
        part.position.y =
          -0.8 +
          Math.floor(i / 3) * 0.46 +
          (unsafe ? THREE.MathUtils.smoothstep(p, 0.4, 0.55) * 2.3 : 0);
        part.rotation.z = (1 - align) * (i % 2 ? 0.18 : -0.13);
        part.updateMatrix();
        for (let n = 0; n < 8; n++) {
          const value = parseInt(payload[(i * 8 + n) % payload.length], 16);
          stripeTransform.position.set(-0.23 + n * 0.063, 0, 0.129);
          stripeTransform.scale.set(
            0.009 + (value % 3) * 0.006,
            0.11 + value * 0.01,
            0.006,
          );
          stripeTransform.updateMatrix();
          stripeMatrix.multiplyMatrices(part.matrix, stripeTransform.matrix);
          byteStripes.setMatrixAt(i * 8 + n, stripeMatrix);
        }
      });
      byteStripes.instanceMatrix.needsUpdate = true;
      nodes.forEach((node, i) => {
        node.visible = p > 0.22;
        positions.set(
          [
            node.position.x,
            node.position.y,
            node.position.z,
            fragments[i].position.x,
            fragments[i].position.y,
            fragments[i].position.z,
          ],
          i * 6,
        );
      });
      lines.visible = p > 0.22 && p < 0.72;
      lineGeometry.attributes.position.needsUpdate = true;
      gate.rotation.y = -0.13 + p * 0.12;
      camera.position.x = 8 - p * 1.8;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    draw.current = render;
    const resize = new ResizeObserver(() => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render(latest.current);
    });
    resize.observe(mount);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      render(latest.current);
    });
    observer.observe(mount);
    const visibility = () => {
      renderer.domElement.style.visibility = 'visible';
      render(latest.current);
    };
    document.addEventListener('visibilitychange', visibility);
    const lost = (event: Event) => {
      event.preventDefault();
      renderer.domElement.style.visibility = 'hidden';
    };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    renderer.domElement.addEventListener('webglcontextrestored', visibility);
    return () => {
      draw.current = null;
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        visibility,
      );
      geometries.forEach((g) => g.dispose());
      bolts.dispose();
      byteStripes.dispose();
      metal.dispose();
      dark.dispose();
      pale.dispose();
      edgeMaterial.dispose();
      lineMaterial.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div className="guard-canvas" ref={host} aria-hidden="true" />;
}
