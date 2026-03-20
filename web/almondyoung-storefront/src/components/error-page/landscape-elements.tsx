"use client"

import { motion } from "framer-motion"

import {
  CLOUDS,
  FLOATING_ISLANDS,
  FLOWERS,
  MOUNTAINS,
  PANORAMA_CONFIG,
  RAINBOW,
  SUN,
  TREES,
} from "./constants"

import CloudSvg from "./assets/landscape/cloud"
import FloatingIslandSvg from "./assets/landscape/floating-island"
import FlowerSvg from "./assets/landscape/flower"
import GrassSvg from "./assets/landscape/grass"
import MountainSvg from "./assets/landscape/mountain"
import RainbowSvg from "./assets/landscape/rainbow"
import SunSvg from "./assets/landscape/sun"
import TreeSvg from "./assets/landscape/tree"

interface LandscapeElementsProps {
  reducedMotion?: boolean
}

export default function LandscapeElements({
  reducedMotion = false,
}: LandscapeElementsProps) {
  return (
    <>
      {/* 태양 */}
      <motion.div
        style={{
          position: "absolute",
          left: SUN.x,
          top: SUN.y,
          zIndex: SUN.zIndex,
        }}
        animate={
          reducedMotion
            ? {}
            : {
                scale: [1, 1.05, 1],
                opacity: [0.9, 1, 0.9],
              }
        }
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <SunSvg />
      </motion.div>

      {/* 구름들 - 천천히 움직임 */}
      {CLOUDS.map((cloud, index) => (
        <motion.div
          key={`cloud-${index}`}
          style={{
            position: "absolute",
            left: cloud.x,
            top: cloud.y,
            zIndex: cloud.zIndex,
            transform: `scale(${cloud.scale})`,
          }}
          animate={
            reducedMotion
              ? {}
              : {
                  x: [0, 30, 0, -20, 0],
                }
          }
          transition={{
            duration: 20 + index * 5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <CloudSvg variant={cloud.variant} />
        </motion.div>
      ))}

      {/* 무지개 */}
      <div
        style={{
          position: "absolute",
          left: RAINBOW.x,
          top: RAINBOW.y,
          zIndex: RAINBOW.zIndex,
          opacity: 0.6,
        }}
      >
        <RainbowSvg />
      </div>

      {/* 떠다니는 섬들 */}
      {FLOATING_ISLANDS.map((island, index) => (
        <motion.div
          key={`floating-island-${index}`}
          style={{
            position: "absolute",
            left: island.x,
            top: island.y,
            zIndex: island.zIndex,
            transform: `scale(${island.scale})`,
          }}
          animate={
            reducedMotion
              ? {}
              : {
                  y: [0, -15, 0, -10, 0],
                  x: [0, 10, 0, -5, 0],
                }
          }
          transition={{
            duration: 6 + index * 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <FloatingIslandSvg variant={island.variant} />
        </motion.div>
      ))}

      {/* 먼 산들 */}
      {MOUNTAINS.filter((m) => m.variant === 1 || m.variant === 2).map(
        (mountain, index) => (
          <div
            key={`far-mountain-${index}`}
            style={{
              position: "absolute",
              left: mountain.x,
              top: mountain.y,
              zIndex: mountain.zIndex,
              transform: `scale(${mountain.scale})`,
              transformOrigin: "bottom center",
            }}
          >
            <MountainSvg variant={mountain.variant} />
          </div>
        )
      )}

      {/* 가까운 산들 */}
      {MOUNTAINS.filter((m) => m.variant === 3 || m.variant === 4).map(
        (mountain, index) => (
          <div
            key={`near-mountain-${index}`}
            style={{
              position: "absolute",
              left: mountain.x,
              top: mountain.y,
              zIndex: mountain.zIndex,
              transform: `scale(${mountain.scale})`,
              transformOrigin: "bottom center",
            }}
          >
            <MountainSvg variant={mountain.variant} />
          </div>
        )
      )}

      {/* 잔디 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: PANORAMA_CONFIG.groundY,
          zIndex: 20,
          width: PANORAMA_CONFIG.width,
        }}
      >
        <GrassSvg />
      </div>

      {/* 나무들 */}
      {TREES.map((tree, index) => (
        <motion.div
          key={`tree-${index}`}
          style={{
            position: "absolute",
            left: tree.x,
            top: tree.y,
            zIndex: tree.zIndex,
            transform: `scale(${tree.scale})`,
            transformOrigin: "bottom center",
          }}
          animate={
            reducedMotion
              ? {}
              : {
                  rotate: [-1, 1, -1],
                }
          }
          transition={{
            duration: 3 + index * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <TreeSvg variant={tree.variant} />
        </motion.div>
      ))}

      {/* 꽃들 */}
      {FLOWERS.map((flower, index) => (
        <motion.div
          key={`flower-${index}`}
          style={{
            position: "absolute",
            left: flower.x,
            top: flower.y,
            zIndex: flower.zIndex,
            transform: `scale(${flower.scale})`,
            transformOrigin: "bottom center",
          }}
          animate={
            reducedMotion
              ? {}
              : {
                  rotate: [-3, 3, -3],
                }
          }
          transition={{
            duration: 2 + (index % 3) * 0.3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <FlowerSvg variant={flower.variant} />
        </motion.div>
      ))}
    </>
  )
}
