import type {Annotation,Point} from './types.js'

export function annotationControlPoints(shape:Annotation): readonly (readonly [string,number,number])[] {
    if(['line','arrow','polygon','cloudy-polygon','polyline'].includes(shape.tool))return shape.points.map(([x,y],index)=>['vertex:'+index,x,y] as const)
    if(shape.tool==='callout')return [['vertex:2',...shape.points[2]],['vertex:3',...shape.points[3]]]
    return []
}
export function moveAnnotationVertex(shape:Annotation,index:number,point:Point):Annotation {
    if(!annotationControlPoints(shape).some(([key])=>key==='vertex:'+index)||!point.every(value=>Number.isFinite(value)&&value>=0&&value<=1))throw new RangeError('Invalid annotation control point')
    return {...shape,points:shape.points.map((value,i)=>i===index?point:value)}
}
