/**
 * Duppel — Audio Fingerprint Module
 * AudioBuffer getChannelData noise, Sensor API defense, ultrasonic attenuation.
 */

export function installAudio(ctx) {
  const { ORIG, profile, spoof, disguise } = ctx;

  // === AudioContext fingerprint noise ===
  // Rowan pass 4 finding #5: deterministic per-sample noise.
  // Uses hash(audioSeed + channel + sampleIndex + sampleValue) for stability.
  //
  // Rowan pass 6 finding #3: getChannelData returns a live reference to the
  // underlying Float32Array. Mutating in-place means repeated reads compound
  // noise (each call re-noises already-noised data). Fix: track which
  // buffer+channel combos have been noised via WeakMap. Apply noise exactly
  // once per buffer+channel; subsequent reads return the already-noised buffer.
  if (ORIG.getChannelData) {
    const _noisedBuffers = new WeakMap();

    AudioBuffer.prototype.getChannelData = disguise(function(channel) {
      const data = ORIG.getChannelData.call(this, channel);

      // Only noise each buffer+channel once
      let noised = _noisedBuffers.get(this);
      if (!noised) { noised = new Set(); _noisedBuffers.set(this, noised); }
      if (noised.has(channel)) return data;
      noised.add(channel);

      const seed = profile.audioSeed ^ (channel * 0x9e3779b9);
      for (let i = 0; i < data.length; i++) {
        // Deterministic micro-noise from seed + position + quantized value
        let h = seed ^ (i * 2654435761);
        h = Math.imul(h ^ ((data[i] * 1e6) >>> 0), 0x45d9f3b);
        h = (h ^ (h >>> 16)) >>> 0;
        data[i] += ((h % 200) - 100) * 0.0000005; // ~±0.00005
      }
      return data;
    }, "getChannelData");
  }

  // === Sensor API defense (v1.1 item 3) ===
  // Desktop Chrome exposes DeviceMotion/Orientation events and Generic
  // Sensor API on convertible laptops with MEMS sensors (accelerometer,
  // gyroscope). Research: ETH Zurich demonstrated >94% cross-site
  // fingerprinting accuracy from motion data alone. JShelter proves the
  // prototype-override approach works in production.
  //
  // Strategy: override prototype getters to return null/zero values,
  // consistent with a standard desktop without sensor hardware.
  // Does NOT delete constructors (that changes API surface and is
  // itself a fingerprinting signal).

  // DeviceMotionEvent: null acceleration/rotationRate = no sensor hardware
  if (typeof DeviceMotionEvent !== "undefined") {
    spoof(DeviceMotionEvent.prototype, "acceleration", () => null);
    spoof(DeviceMotionEvent.prototype, "accelerationIncludingGravity", () => null);
    spoof(DeviceMotionEvent.prototype, "rotationRate", () => null);
    spoof(DeviceMotionEvent.prototype, "interval", () => 0);
  }

  // DeviceOrientationEvent: null alpha/beta/gamma = no sensor hardware
  if (typeof DeviceOrientationEvent !== "undefined") {
    spoof(DeviceOrientationEvent.prototype, "alpha", () => null);
    spoof(DeviceOrientationEvent.prototype, "beta", () => null);
    spoof(DeviceOrientationEvent.prototype, "gamma", () => null);
    spoof(DeviceOrientationEvent.prototype, "absolute", () => false);
  }

  // Generic Sensor API: override reading properties on all sensor prototypes.
  // Accelerometer, Gyroscope, etc. — x/y/z return null (no hardware).
  // AmbientLightSensor is behind an expired Chrome flag, included for completeness.
  const _sensorClasses = [
    "Accelerometer", "Gyroscope", "LinearAccelerationSensor",
    "AbsoluteOrientationSensor", "RelativeOrientationSensor",
    "GravitySensor", "Magnetometer", "AmbientLightSensor",
  ];
  const _sensorProps = ["x", "y", "z", "quaternion", "illuminance"];
  for (const cls of _sensorClasses) {
    if (typeof window[cls] !== "undefined") {
      for (const prop of _sensorProps) {
        spoof(window[cls].prototype, prop, () => null);
      }
    }
  }

  // === WebAudio near-ultrasonic attenuation (v1.1 item 4) ===
  // Intercepts AudioNode.connect() to insert a BiquadFilterNode (highshelf
  // at 17999 Hz, -70 dB) before any AudioDestinationNode. Attenuates
  // near-ultrasonic frequencies (17-20 kHz) used by cross-device tracking
  // beacons (SilverPush, USAT framework). Based on Silverdog/SilverWall
  // proven approach (PETS 2017). Does not affect audible audio (<17 kHz).
  //
  // Breakage risk: low. Near-ultrasonic frequencies are inaudible to most
  // adults. Affected niche uses: data-over-sound device pairing (Chirp.io,
  // Google Nearby — both deprecated), dog whistle apps, web audiometry.
  // These can be whitelisted per-site via the existing __pgd cookie.
  if (ORIG.audioConnect) {
    AudioNode.prototype.connect = disguise(function connect(destination, output, input) {
      // Insert ultrasonic filter before AudioDestinationNode (speakers)
      // AND before AnalyserNode (lux review: USAT trackers route
      // MediaElementSource → AnalyserNode to read ultrasonic frequencies
      // upstream of any destination filter).
      if (destination instanceof AudioDestinationNode ||
          destination instanceof AnalyserNode) {
        try {
          const audioCtx = this.context || destination.context;
          const filter = audioCtx.createBiquadFilter();
          filter.type = "highshelf";
          filter.frequency.value = 17999;
          filter.Q.value = 0;
          filter.gain.value = -70;
          // Preserve caller's output index; filter input is always 0
          ORIG.audioConnect.call(this, filter, output, 0);
          // Preserve caller's input index; filter output is always 0
          return ORIG.audioConnect.call(filter, destination, 0, input);
        } catch(e) {
          return ORIG.audioConnect.call(this, destination, output, input);
        }
      }
      return ORIG.audioConnect.call(this, destination, output, input);
    }, "connect", 1);
  }
}
