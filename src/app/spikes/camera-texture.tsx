import { CameraView, useCameraPermissions } from 'expo-camera';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useCallback, useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { edgeFill, exposure, laplacianVariance, toGray } from '@/domain/quality/metrics';
import { scorePreview } from '@/domain/quality/score';
import { T } from '@/domain/quality/thresholds';
import type { LiveMetrics } from '@/domain/quality/types';

/**
 * SPIKE 1 — the load-bearing assumption of the whole capture design.
 *
 * expo-camera exposes NO frame-processor API, so there is no supported way to
 * read preview pixels before the shutter. The workaround: expo-gl IS in Expo
 * Go and still ships GLView.createCameraTextureAsync(), which hands you the
 * live preview as a WebGL texture. Draw it into a tiny offscreen framebuffer,
 * readPixels, and you have real pre-shutter pixel access with no native build.
 *
 * THE RISK: that API was originally documented against the legacy Camera
 * component, and expo-camera was rewritten to CameraView. Whether the new ref
 * is still an acceptable argument is exactly what this screen answers.
 *
 * PASS -> live quality warnings ship in milestone 1.
 * FAIL -> cut them. Keep the static framing guide and coaching copy, and let
 *         the post-shutter gate catch bad photos. Annoying, not broken.
 *         Do NOT fall back to polling takePictureAsync(): it runs the real
 *         capture pipeline, writes to disk, and wrecks battery and thermals.
 */

const S = 96; // analysis resolution - 9,216 px is ~37KB per readPixels
const GUIDE = { x0: 0.11, y0: 0.13, x1: 0.89, y1: 0.87 };

const VERT = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D cam;
varying vec2 uv;
void main() { gl_FragColor = texture2D(cam, uv); }`;

function compile(gl: ExpoWebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

export default function CameraTextureSpike() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      setStatus('running');

      // THE CALL UNDER TEST.
      const camTex = await (
        GLView as unknown as {
          createCameraTextureAsync: (ref: unknown) => Promise<WebGLTexture | null>;
        }
      ).createCameraTextureAsync(cameraRef.current);

      if (!camTex) throw new Error('createCameraTextureAsync returned nothing');

      // Offscreen S x S RGBA target.
      const target = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('framebuffer incomplete');
      }

      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`link failed: ${gl.getProgramInfoLog(prog)}`);
      }
      gl.useProgram(prog);

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const loc = gl.getAttribLocation(prog, 'position');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'cam'), 0);

      const pixels = new Uint8Array(S * S * 4);
      let last = 0;
      let frames = 0;
      let fpsWindow = 0;

      const loop = (t: number) => {
        rafRef.current = requestAnimationFrame(loop);
        if (t - last < 1000 / T.live.hz) return;
        last = t;

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, S, S);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, camTex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.endFrameEXP();

        const g = toGray(pixels, S * S);
        const e = exposure(g);
        setMetrics({
          ...e,
          lapVar: laplacianVariance(g, S, S),
          edgeFill: edgeFill(g, S, S, GUIDE),
        });

        frames++;
        if (t - fpsWindow > 1000) {
          setFps(frames);
          frames = 0;
          fpsWindow = t;
        }
        setStatus('pass');
      };

      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('fail');
    }
  }, []);

  if (!permission) return <Text style={styles.pad}>Checking camera permission...</Text>;

  if (!permission.granted) {
    return (
      <View style={styles.pad}>
        <Text style={styles.body}>This spike needs the camera.</Text>
        <Button title="Grant camera access" onPress={requestPermission} />
      </View>
    );
  }

  const issues = metrics ? scorePreview(metrics) : [];

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={styles.fill} facing="back" />
      {/* 1x1 and effectively invisible: we want its GL context, not its output. */}
      <GLView style={styles.hidden} onContextCreate={onContextCreate} />

      <View style={styles.panel}>
        <Text
          style={[styles.verdict, status === 'pass' && styles.ok, status === 'fail' && styles.bad]}>
          {status === 'pass'
            ? `PASS - live pixels at ${fps}/s`
            : status === 'fail'
              ? 'FAIL - cut live warnings'
              : 'starting...'}
        </Text>

        {error ? <Text style={styles.err}>{error}</Text> : null}

        {metrics ? (
          <>
            <Text style={styles.row}>luma {metrics.luma.toFixed(1)}</Text>
            <Text style={styles.row}>lapVar {metrics.lapVar.toFixed(1)}</Text>
            <Text style={styles.row}>
              clip lo {(metrics.clipLow * 100).toFixed(1)}% hi{' '}
              {(metrics.clipHigh * 100).toFixed(1)}%
            </Text>
            <Text style={styles.row}>edgeFill {(metrics.edgeFill * 100).toFixed(0)}%</Text>
            <Text style={styles.issues}>{issues.length ? issues.join(', ') : 'no issues'}</Text>
          </>
        ) : null}

        <Text style={styles.hint}>
          Cover the lens, expect too_dark. Wave the phone, expect lapVar to drop.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0.01 },
  pad: { padding: 16, gap: 12 },
  body: { fontSize: 15, marginBottom: 8 },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 28,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  verdict: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  ok: { color: '#7BE38B' },
  bad: { color: '#FF8A80' },
  err: { color: '#FF8A80', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 },
  row: { color: '#fff', fontFamily: 'monospace', fontSize: 13 },
  issues: { color: '#FFD479', fontFamily: 'monospace', fontSize: 13, marginTop: 6 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 10, lineHeight: 16 },
});
