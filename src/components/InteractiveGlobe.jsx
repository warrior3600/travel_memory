import { useEffect, useRef } from 'react';

function generatePoints(count) {
  const points = [];
  const phi = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    points.push({ x, y, z });
  }

  return points;
}

export default function InteractiveGlobe() {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    const points = generatePoints(720);
    let width = 0;
    let height = 0;
    let frame = 0;
    let rafId = null;

    const resize = () => {
      width = wrapper.clientWidth;
      height = wrapper.clientHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    const handlePointerMove = (event) => {
      const rect = wrapper.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      pointer.current.x = (px - 0.5) * 2;
      pointer.current.y = (py - 0.5) * 2;
    };

    const draw = () => {
      frame += 0.004;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.66;
      const radius = Math.min(width * 0.43, height * 0.74);
      const tilt = pointer.current.y * 0.35;
      const spin = frame + pointer.current.x * 0.7;

      const gradient = ctx.createRadialGradient(cx, cy - radius * 0.6, radius * 0.1, cx, cy, radius * 1.2);
      gradient.addColorStop(0, 'rgba(44, 164, 255, 0.35)');
      gradient.addColorStop(1, 'rgba(5, 18, 65, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(33, 125, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const xzX = p.x * Math.cos(spin) - p.z * Math.sin(spin);
        const xzZ = p.x * Math.sin(spin) + p.z * Math.cos(spin);
        const yzY = p.y * Math.cos(tilt) - xzZ * Math.sin(tilt);
        const yzZ = p.y * Math.sin(tilt) + xzZ * Math.cos(tilt);

        const depth = (yzZ + 1) / 2;
        const alpha = depth * 0.85 + 0.15;
        const dotSize = depth * 2.1 + 0.3;
        const px = cx + xzX * radius;
        const py = cy + yzY * radius;

        ctx.fillStyle = `rgba(109, 206, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    wrapper.addEventListener('pointermove', handlePointerMove);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', resize);
      wrapper.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="globe-canvas-wrap" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
