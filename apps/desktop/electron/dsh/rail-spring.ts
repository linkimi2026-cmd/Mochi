export interface RailSpringValue {
  position: number;
  velocity: number;
}

/** Advance a critically damped spring by an exact time step. */
export function advanceRailSpring(
  value: RailSpringValue,
  target: number,
  elapsedSeconds: number,
  responseSeconds = 0.4,
): RailSpringValue {
  if (elapsedSeconds <= 0) return value;
  if (!Number.isFinite(responseSeconds) || responseSeconds <= 0) {
    throw new RangeError("responseSeconds must be a positive finite number");
  }

  // This mapping reaches roughly 95% of a rest-to-rest move within responseSeconds.
  const angularFrequency = 4.8 / responseSeconds;
  const displacement = value.position - target;
  const coefficient = value.velocity + angularFrequency * displacement;
  const decay = Math.exp(-angularFrequency * elapsedSeconds);
  return {
    position: target + (displacement + coefficient * elapsedSeconds) * decay,
    velocity: (value.velocity - angularFrequency * coefficient * elapsedSeconds) * decay,
  };
}

export function isRailSpringSettled(value: RailSpringValue, target: number): boolean {
  return Math.abs(value.position - target) < 0.5 && Math.abs(value.velocity) < 8;
}
