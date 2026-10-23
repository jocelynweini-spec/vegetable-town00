/* ============================================================
   3D 角色档案 · Three.js 立牌渲染
   ============================================================ */
import * as THREE from '../vendor/three.module.js';

export function createArchive3D(container) {
  const width = () => container.clientWidth || 800;
  const height = () => container.clientHeight || 600;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width(), height());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width() / height(), 0.1, 100);
  camera.position.set(0, 1.35, 5.4);
  camera.lookAt(0, 1.05, 0);

  scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x1a1030, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2.5, 4, 3.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x00ffcc, 1.4);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const pink = new THREE.PointLight(0xff7fa3, 1.2, 12);
  pink.position.set(2.5, 1.5, 2.5);
  scene.add(pink);

  const group = new THREE.Group();
  scene.add(group);

  // 展台
  const stageMat = new THREE.MeshStandardMaterial({
    color: 0x1b1136, roughness: 0.45, metalness: 0.55,
    emissive: 0x0a2030, emissiveIntensity: 0.6
  });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.16, 48), stageMat);
  pedestal.position.y = -0.02;
  group.add(pedestal);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.75 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.012, 8, 90), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.07;
  group.add(ring);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.008, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0xff7fa3, transparent: true, opacity: 0.5 }));
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.08;
  group.add(ring2);

  // 星尘
  const starGeo = new THREE.BufferGeometry();
  const starCount = 90;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 1.5 + Math.random() * 2.2;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.2 + Math.random() * 2.4;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x00ffcc, size: 0.028, transparent: true, opacity: 0.8
  }));
  group.add(stars);

  // 当前立牌
  let standee = null;
  let frameLines = null;

  const loader = new THREE.TextureLoader();
  const cache = new Map();

  function loadTexture(src) {
    if (cache.has(src)) return Promise.resolve(cache.get(src));
    return new Promise((resolve, reject) => {
      loader.load(src, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        cache.set(src, tex);
        resolve(tex);
      }, undefined, reject);
    });
  }

  function show(src) {
    loadTexture(src).then(tex => {
      if (standee) {
        group.remove(standee);
        standee.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
      if (frameLines) { group.remove(frameLines); frameLines = null; }

      const img = tex.image;
      const ratio = img.width / img.height;
      const h = 2.25;
      const w = Math.min(h * ratio, 2.4);

      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, alphaTest: 0.05,
        roughness: 0.85, metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: 0x120820, emissiveIntensity: 0.25
      });
      standee = new THREE.Mesh(geo, mat);
      standee.position.y = h / 2 + 0.12;
      group.add(standee);

      // 全息描边框
      const edge = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w * 1.04, h * 1.04));
      frameLines = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({
        color: 0x00ffcc, transparent: true, opacity: 0.35
      }));
      frameLines.position.copy(standee.position);
      frameLines.position.z -= 0.01;
      group.add(frameLines);

      // 入场动画
      standee.scale.set(0.01, 0.01, 0.01);
      const t0 = performance.now();
      const grow = () => {
        const k = Math.min(1, (performance.now() - t0) / 320);
        const e = 1 - Math.pow(1 - k, 3);
        standee.scale.set(e, e, e);
        if (k < 1) requestAnimationFrame(grow);
      };
      grow();
    }).catch(err => console.error('texture load failed', src, err));
  }

  // ------- 交互 -------
  let drag = false, lastX = 0, lastY = 0;
  let rotY = 0, rotX = 0, targetRotY = 0, targetRotX = 0;
  let auto = true;

  function onDown(e) {
    drag = true; auto = false;
    lastX = e.clientX; lastY = e.clientY;
    container.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    targetRotY += dx * 0.01;
    targetRotX = Math.max(-0.5, Math.min(0.5, targetRotX + dy * 0.006));
  }
  function onUp(e) {
    drag = false;
    container.releasePointerCapture?.(e.pointerId);
  }
  function onWheel(e) {
    e.preventDefault();
    camera.position.z = Math.max(3.4, Math.min(8, camera.position.z + e.deltaY * 0.002));
    camera.lookAt(0, 1.05, 0);
  }
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointerleave', onUp);
  container.addEventListener('wheel', onWheel, { passive: false });

  // ------- 渲染循环 -------
  let raf = 0;
  let alive = true;
  const clock = new THREE.Clock();

  function animate() {
    if (!alive) return;
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    if (auto) targetRotY += 0.004;

    rotY += (targetRotY - rotY) * 0.09;
    rotX += (targetRotX - rotX) * 0.09;
    group.rotation.y = rotY;
    group.rotation.x = rotX;

    if (standee) standee.position.y = 1.25 + Math.sin(t * 1.1) * 0.035;
    if (frameLines) frameLines.position.y = standee ? standee.position.y : 1.25;

    ring.rotation.z = t * 0.4;
    ring2.rotation.z = -t * 0.7;
    stars.rotation.y = t * 0.06;

    renderer.render(scene, camera);
  }
  animate();

  // ------- 自适应 -------
  const ro = new ResizeObserver(() => {
    const w = width(), h = height();
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return {
    show,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointerleave', onUp);
      container.removeEventListener('wheel', onWheel);
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      cache.clear();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
