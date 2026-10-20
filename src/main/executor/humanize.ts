// 拟人化输入的纯计算：随机延迟与贝塞尔鼠标轨迹。
import type { Point } from '../../shared/types'

export type Rand = () => number

export function randomInt(min: number, max: number, rand: Rand = Math.random): number {
  const lo = Math.ceil(Math.min(min, max))
  const hi = Math.floor(Math.max(min, max))
  return lo + Math.floor(rand() * (hi - lo + 1))
}

export interface TrajectoryOptions {
  minSteps: number
  maxSteps: number
  minDelayMs: number
  maxDelayMs: number
  curvature: number
}

export const DEFAULT_TRAJECTORY: TrajectoryOptions = {
  minSteps: 12,
  maxSteps: 40,
  minDelayMs: 3,
  maxDelayMs: 14,
  curvature: 0.18
}

export interface TrajectoryPoint extends Point {
  delayMs: number
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

// 三次贝塞尔曲线：控制点沿起终点连线的法线方向随机偏移，步数随距离增长，两端慢中间快
export function bezierPath(
  from: Point,
  to: Point,
  options: Partial<TrajectoryOptions> = {},
  rand: Rand = Math.random
): TrajectoryPoint[] {
  const o = { ...DEFAULT_TRAJECTORY, ...options }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance < 1) return [{ x: Math.round(to.x), y: Math.round(to.y), delayMs: 0 }]

  const steps = Math.round(Math.min(o.maxSteps, Math.max(o.minSteps, distance / 18)))
  const nx = -dy / distance
  const ny = dx / distance
  const offset1 = (rand() - 0.5) * 2 * distance * o.curvature
  const offset2 = (rand() - 0.5) * 2 * distance * o.curvature
  const c1 = { x: from.x + dx * 0.3 + nx * offset1, y: from.y + dy * 0.3 + ny * offset1 }
  const c2 = { x: from.x + dx * 0.7 + nx * offset2, y: from.y + dy * 0.7 + ny * offset2 }

  const points: TrajectoryPoint[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const speed = Math.sin(t * Math.PI)
    const base = o.maxDelayMs - (o.maxDelayMs - o.minDelayMs) * speed
    points.push({
      x: Math.round(cubic(from.x, c1.x, c2.x, to.x, t)),
      y: Math.round(cubic(from.y, c1.y, c2.y, to.y, t)),
      delayMs: Math.max(0, Math.round(base + (rand() - 0.5) * 2))
    })
  }
  points[points.length - 1] = { x: Math.round(to.x), y: Math.round(to.y), delayMs: points[points.length - 1].delayMs }
  return points
}
