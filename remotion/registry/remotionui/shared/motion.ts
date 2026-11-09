import type {SpringConfig} from "remotion";

export type MotionSpring = boolean | "smooth" | "snappy" | "bouncy" | Partial<SpringConfig>;

const SPRING_SMOOTH: SpringConfig = {
  damping: 200,
  mass: 1,
  stiffness: 100,
  overshootClamping: true,
};

const SPRING_SNAPPY: SpringConfig = {
  damping: 20,
  mass: 0.8,
  stiffness: 200,
  overshootClamping: true,
};

const SPRING_BOUNCY: SpringConfig = {
  damping: 12,
  mass: 0.9,
  stiffness: 180,
  overshootClamping: false,
};

export function resolveSpringConfig(value: MotionSpring): SpringConfig {
  if (value === true || value === false) return SPRING_SNAPPY;
  if (value === "smooth") return SPRING_SMOOTH;
  if (value === "bouncy") return SPRING_BOUNCY;
  if (value === "snappy") return SPRING_SNAPPY;
  return {...SPRING_SNAPPY, ...value};
}
