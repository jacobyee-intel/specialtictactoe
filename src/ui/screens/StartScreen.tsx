import { useEffect, useRef, useState } from 'preact/hooks';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { navigate } from '../router';
import { ScreenNav } from './ScreenNav';

export function StartScreen() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const mount = previewRef.current;

    if (!mount) {
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      // three.js throws when no WebGL context can be created.
      console.warn('WebGL unavailable; skipping 3D preview.', error);
      setWebglFailed(true);
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100);
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial({ color: 0x3b82f6, wireframe: true });
    const cube = new Mesh(geometry, material);
    let animationFrame = 0;

    camera.position.z = 3;
    scene.add(cube);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(240, 180);
    renderer.domElement.setAttribute('aria-label', 'Rotating wireframe cube preview');
    renderer.domElement.setAttribute('role', 'img');
    mount.append(renderer.domElement);

    const animate = () => {
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.014;
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section class="screen start-layout" aria-labelledby="start-title">
      <div>
        <h1 id="start-title">Multiverse Tic-Tac-Toe in Impossible Spaces</h1>
        <p>
          A scaffolded shell for branching timeline play across wrapped cubic spaces,
          tesseract-surface boards, and a hyperbolic multiverse map.
        </p>
        <div class="button-row">
          <button class="primary" type="button" onClick={() => navigate('multiverse')}>
            Start game
          </button>
        </div>
        <ScreenNav current="start" />
      </div>
      <aside class="preview-card" aria-label="three.js smoke test">
        <div ref={previewRef} />
        <span>
          {webglFailed
            ? 'WebGL is unavailable in this browser, so the 3D preview is disabled.'
            : 'three.js wireframe smoke test'}
        </span>
      </aside>
    </section>
  );
}
