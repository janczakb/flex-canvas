import type {Point} from './types.js'

/** Bounded scalloped outline. Original normalized polygon vertices remain unchanged. */
export function cloudOutline(points:readonly Point[],width:number,height:number,stroke:number,intensity=1) {
    const vertices=points.map(([x,y])=>[x*width,y*height] as const)
    const lengths=vertices.map((point,index)=>{const next=vertices[(index+1)%vertices.length];return Math.hypot(next[0]-point[0],next[1]-point[1])})
    const perimeter=lengths.reduce((sum,length)=>sum+length,0)
    const step=Math.max(12,stroke*5*intensity,perimeter/Math.max(1,1024-vertices.length))
    const area=vertices.reduce((sum,[x,y],index)=>{const [u,v]=vertices[(index+1)%vertices.length];return sum+x*v-u*y},0)
    const direction=area>=0?1:-1
    const curves:readonly number[][] = vertices.flatMap(([x,y],index)=>{
        const [u,v]=vertices[(index+1)%vertices.length],length=lengths[index]
        if(length===0)return []
        const count=Math.max(1,Math.ceil(length/step)),dx=(u-x)/count,dy=(v-y)/count
        return Array.from({length:count},(_,segment)=>[
            x+dx*(segment+.5)+dy*.75*direction,
            y+dy*(segment+.5)-dx*.75*direction,
            x+dx*(segment+1),y+dy*(segment+1),
        ])
    })
    return {start:vertices[0],curves}
}
