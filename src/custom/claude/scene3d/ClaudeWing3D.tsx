// custom: the Claude wing of the 3D office (inside the Canvas). Agents' states come only from the
// Claude boards (server/custom/claude/teams.ts agentLine); only a Working agent types.
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { agentLook } from '../../../agents.ts'
import type { Vec3 } from '../../../office3d-layout.ts'
import { Plant, RBox, Sofa, WorkDesk } from '../../../scene3d/props.tsx'
import { signTexture } from '../../../scene3d/textures.ts'
import type { AgentLine, ClaudeOverview } from '../types.ts'
import { wingPlacement, type WingDesk, type WingLayout } from '../wing-layout.ts'

const ACCENT = '#d97757'
const WALL = '#f3ebe3'
const WALL_TOP = '#e0cfc2'
const THICK = 0.25

function Wall({ from, to, height }: { from: [number, number]; to: [number, number]; height: number }) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  return <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, -angle, 0]}>
    <RBox position={[0, height / 2, 0]} size={[length + THICK, height, THICK]} radius={0.02} color={WALL} roughness={0.9}/>
    <RBox position={[0, height + 0.02, 0]} size={[length + THICK + 0.02, 0.05, THICK + 0.04]} radius={0.01} color={WALL_TOP}/>
  </group>
}

function Plane({ position, size, color }: { position: Vec3; size: [number, number]; color: string }) {
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={size}/><meshStandardMaterial color={color} roughness={0.9}/></mesh>
}

function Sign({ position, width, height, texture }: { position: Vec3; width: number; height: number; texture: THREE.Texture }) {
  return <mesh position={position}><planeGeometry args={[width, height]}/><meshStandardMaterial map={texture} roughness={0.6}/></mesh>
}

/** A figure at its place. Arms type only while the board says the agent works. */
function Avatar({ agent, position, facing, seated, onSelect, anchor }: { agent: AgentLine; position: Vec3; facing: number; seated: boolean; onSelect: () => void; anchor: (object: THREE.Object3D | null) => void }) {
  const leftArm = useRef<THREE.Mesh>(null)
  const rightArm = useRef<THREE.Mesh>(null)
  const look = agentLook(agent.code)
  const paused = agent.state === 'Paused'
  const tint = (color: string) => (paused ? '#8a8d8b' : color)
  const typing = agent.state === 'Working'
  useFrame((state) => {
    const time = state.clock.elapsedTime
    if (leftArm.current && rightArm.current) {
      leftArm.current.rotation.x = typing ? -1.1 + Math.sin(time * 14) * 0.12 : seated ? -0.5 : 0
      rightArm.current.rotation.x = typing ? -1.1 + Math.cos(time * 14) * 0.12 : seated ? -0.5 : 0
    }
  })
  const legX = seated ? -Math.PI / 2.2 : 0
  const lift = seated ? -0.14 : 0
  return <group position={position} rotation={[0, facing, 0]} onClick={(event) => { event.stopPropagation(); onSelect() }} onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
    <group position={[0, lift, 0]}>
      <mesh position={[-0.11, 0.66, 0]} rotation={[legX, 0, 0]} geometry={legGeometry} castShadow><meshStandardMaterial color={tint('#3b3f4a')} roughness={0.8}/></mesh>
      <mesh position={[0.11, 0.66, 0]} rotation={[legX, 0, 0]} geometry={legGeometry} castShadow><meshStandardMaterial color={tint('#3b3f4a')} roughness={0.8}/></mesh>
      {/* Claude agents wear the coral accent; Hermes agents never do. */}
      <RBox position={[0, 0.98, 0]} size={[0.48, 0.58, 0.3]} radius={0.07} color={tint(ACCENT)} roughness={0.85}/>
      <mesh ref={leftArm} position={[-0.31, 1.2, 0]} geometry={armGeometry} castShadow><meshStandardMaterial color={tint(ACCENT)} roughness={0.85}/></mesh>
      <mesh ref={rightArm} position={[0.31, 1.2, 0]} geometry={armGeometry} castShadow><meshStandardMaterial color={tint(ACCENT)} roughness={0.85}/></mesh>
      <RBox position={[0, 1.5, 0]} size={[0.4, 0.4, 0.37]} radius={0.08} color={tint(look.skin)} roughness={0.7}/>
      <RBox position={[0, 1.72, -0.02]} size={[0.43, 0.13, 0.41]} radius={0.05} color={tint(look.hair)} roughness={0.9}/>
      <RBox position={[-0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
      <RBox position={[0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
    </group>
    {agent.state === 'Unknown' && <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.45, 0.55, 24]}/><meshBasicMaterial color="#e9c47b" transparent opacity={0.85}/></mesh>}
    <object3D ref={anchor} position={[0, 2.05, 0]}/>
  </group>
}

const legGeometry = new THREE.BoxGeometry(0.17, 0.62, 0.2).translate(0, -0.31, 0)
const armGeometry = new THREE.BoxGeometry(0.12, 0.52, 0.14).translate(0, -0.26, 0)

/** A small flag on the desk: this agent's task is in review, waiting for the owner. */
function ReviewFlag({ desk }: { desk: Vec3 }) {
  return <group position={[desk[0] - 0.75, 0.78, desk[2] + 0.25]}>
    <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.012, 0.012, 0.5, 8]}/><meshStandardMaterial color="#5a4636"/></mesh>
    <mesh position={[0.11, 0.42, 0]}><planeGeometry args={[0.22, 0.14]}/><meshStandardMaterial color={ACCENT} side={THREE.DoubleSide} emissive={ACCENT} emissiveIntensity={0.3}/></mesh>
  </group>
}

/** The notifier is a terminal on a stand, not an avatar: it only posts board changes to Slack. */
function Terminal({ position, paused }: { position: Vec3; paused: boolean }) {
  return <group position={position}>
    <RBox position={[0, 0.55, 0]} size={[0.6, 1.1, 0.45]} radius={0.04} color="#2a2f33"/>
    <RBox position={[0, 1.32, 0.05]} size={[0.7, 0.48, 0.06]} radius={0.02} color="#1c2024"/>
    <mesh position={[0, 1.32, 0.085]}><planeGeometry args={[0.62, 0.4]}/><meshStandardMaterial color={paused ? '#1a1d1f' : '#15313a'} emissive={paused ? '#000000' : ACCENT} emissiveIntensity={paused ? 0 : 0.25}/></mesh>
  </group>
}

export interface WingHandlers { anchor: (key: string) => (object: THREE.Object3D | null) => void; onAgent: (team: string, agent: string) => void; onTeam: (team: string) => void }

export function ClaudeWing3D({ data, layout, handlers }: { data: ClaudeOverview; layout: WingLayout; handlers: WingHandlers }) {
  const { minX, maxX, minZ, maxZ } = layout.building
  const sign = useMemo(() => signTexture('CLAUDE', '#2b1d17', ACCENT, 'SCHEDULED-TASK TEAMS'), [])
  const byTeam = new Map(data.teams.map((team) => [team.slug, team]))
  // Idle agents share the lounge sofa in a fixed order (team, then desk).
  const idleOrder = layout.clusters.flatMap((cluster) => cluster.desks.filter((desk) => byTeam.get(cluster.slug)?.agents.find((agent) => agent.code === desk.agent)?.state === 'Idle').map((desk) => desk.agent))
  return <group>
    {/* Grounds: a lawn patch, the floor and a path from the sidewalk to the door. */}
    <Plane position={[(minX + maxX) / 2, -0.015, 1]} size={[maxX - minX + 6, 20]} color="#6f9a57"/>
    <Plane position={[(minX + maxX) / 2, 0.004, (minZ + maxZ) / 2]} size={[maxX - minX, maxZ - minZ]} color="#d8c7b4"/>
    <Plane position={[layout.entranceX, 0.002, maxZ + 1.6]} size={[1.6, 3.2]} color="#b9b2a6"/>
    <Plane position={[(16.5 + maxX) / 2, 0, 6.9]} size={[maxX - 16.5 + 1, 2]} color="#b9b2a6"/>
    {/* Walls: full height at the back and sides, low at the front (cut-away view), a door gap. */}
    <Wall from={[minX, minZ]} to={[maxX, minZ]} height={2.6}/>
    <Wall from={[minX, minZ]} to={[minX, maxZ]} height={2.6}/>
    <Wall from={[maxX, minZ]} to={[maxX, maxZ]} height={2.6}/>
    <Wall from={[minX, maxZ]} to={[layout.entranceX - 0.8, maxZ]} height={0.9}/>
    <Wall from={[layout.entranceX + 0.8, maxZ]} to={[maxX, maxZ]} height={0.9}/>
    <RBox position={[layout.sign[0], layout.sign[1], layout.sign[2]]} size={[4.2, 1.3, 0.1]} radius={0.03} color="#2b1d17"/>
    <Sign position={[layout.sign[0], layout.sign[1], layout.sign[2] + 0.06]} width={4} height={1.25} texture={sign}/>
    <Plant position={[minX + 0.6, 0, maxZ - 0.6]} size={0.9}/>
    {layout.clusters.map((cluster) => {
      const team = byTeam.get(cluster.slug)
      const count = team?.needsYou
      return <group key={cluster.slug}>
        {/* The team's wall board: its Needs-you count, or ? when its boards cannot be read. */}
        <group onClick={(event) => { event.stopPropagation(); handlers.onTeam(cluster.slug) }}>
          <RBox position={cluster.board} size={[1.7, 0.9, 0.06]} radius={0.02} color="#1d2422"/>
          <Sign position={[cluster.board[0], cluster.board[1], cluster.board[2] + 0.035]} width={1.6} height={0.5} texture={signTexture(cluster.paused ? 'PAUSED' : count === null || count === undefined ? '?' : String(count), cluster.paused ? '#3b3f3d' : '#1d2422', cluster.paused ? '#b9bdb9' : ACCENT, cluster.paused ? cluster.code : 'NEEDS YOU')}/>
        </group>
        {/* Team area on the floor, dimmed when paused. */}
        <Plane position={[(cluster.minX + cluster.maxX) / 2, 0.008, -2.2]} size={[cluster.maxX - cluster.minX, 4.6]} color={cluster.paused ? '#b9b3ab' : '#ead7c6'}/>
        {cluster.desks.map((desk) => <DeskWithAgent key={desk.agent} desk={desk} agent={team?.agents.find((item) => item.code === desk.agent)} layout={layout} idleIndex={Math.max(0, idleOrder.indexOf(desk.agent))} onSelect={() => handlers.onAgent(cluster.slug, desk.agent)} anchor={handlers.anchor(`claude-agent-${desk.agent}`)}/>)}
        {cluster.terminal && <group onClick={(event) => { event.stopPropagation(); handlers.onAgent(cluster.slug, cluster.terminal!.agent) }}><Terminal position={cluster.terminal.position} paused={cluster.paused}/><object3D ref={handlers.anchor(`claude-agent-${cluster.terminal.agent}`)} position={[cluster.terminal.position[0], 1.9, cluster.terminal.position[2]]}/></group>}
        <object3D ref={handlers.anchor(`claude-team-${cluster.slug}`)} position={cluster.label}/>
      </group>
    })}
    <Sofa position={layout.lounge.sofa} color="#a85d45"/>
  </group>
}

function DeskWithAgent({ desk, agent, layout, idleIndex, onSelect, anchor }: { desk: WingDesk; agent?: AgentLine; layout: WingLayout; idleIndex: number; onSelect: () => void; anchor: (object: THREE.Object3D | null) => void }) {
  const state = agent?.state ?? 'Unknown'
  const placement = wingPlacement(state, desk, layout, idleIndex)
  return <>
    <WorkDesk position={desk.desk} active={state === 'Working'}/>
    {state === 'Waiting for you' && <ReviewFlag desk={desk.desk}/>}
    {agent && <Avatar agent={agent} position={placement.position} facing={placement.facing} seated={placement.seated} onSelect={onSelect} anchor={anchor}/>}
  </>
}
