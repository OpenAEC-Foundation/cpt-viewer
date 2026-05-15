import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./ThreeViewer.css";

export default function ThreeViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(12, 10, 12);
    camera.lookAt(0, 1, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(10, 15, 10);
    directional.castShadow = true;
    scene.add(directional);

    // Grid
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
    scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(3);
    scene.add(axes);

    // Test model: simple building
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.5,
      metalness: 0.1,
    });

    // Floor slab
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.8 })
    );
    slab.position.set(0, 0.1, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    scene.add(slab);

    // Walls
    const wallGeo = new THREE.BoxGeometry(0.2, 3, 4);
    const wall1 = new THREE.Mesh(wallGeo, buildingMat);
    wall1.position.set(-2.9, 1.5, 0);
    wall1.castShadow = true;
    scene.add(wall1);

    const wall2 = new THREE.Mesh(wallGeo, buildingMat);
    wall2.position.set(2.9, 1.5, 0);
    wall2.castShadow = true;
    scene.add(wall2);

    const backWallGeo = new THREE.BoxGeometry(6, 3, 0.2);
    const wall3 = new THREE.Mesh(backWallGeo, buildingMat);
    wall3.position.set(0, 1.5, -1.9);
    wall3.castShadow = true;
    scene.add(wall3);

    // Roof slab
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 0.15, 4.4),
      new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.6 })
    );
    roof.position.set(0, 3.075, 0);
    roof.castShadow = true;
    scene.add(roof);

    // Columns
    const colGeo = new THREE.BoxGeometry(0.3, 3, 0.3);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.4 });
    const colPositions = [
      [-1, 1.5, 1.85],
      [1, 1.5, 1.85],
    ];
    colPositions.forEach(([x, y, z]) => {
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(x, y, z);
      col.castShadow = true;
      scene.add(col);
    });

    // Add wireframe edges to all meshes
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        const edges = new THREE.EdgesGeometry(obj.geometry);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.15, transparent: true })
        );
        line.position.copy(obj.position);
        line.rotation.copy(obj.rotation);
        scene.add(line);
      }
    });

    // Animation loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
    };
  }, []);

  return <div className="three-viewer-container" ref={containerRef} />;
}
