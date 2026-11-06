import type {AnnotationTool} from './types.js'
import type {ToolProperty} from './toolbar.js'

/** One source for captions, palette labels, tooltips and compact property buttons. */
export function toolPropertyPresentation(property:ToolProperty, tool:AnnotationTool|null): {label:string;icon:string} {
    if(property==='strokeColor')return {label:'stroke_color',icon:'strokeColor'}
    if(property==='noteIcon')return {label:'note_icon',icon:property}
    if(property!=='color')return {label:property,icon:property}
    if(tool==='text'||tool==='callout')return {label:'font_color',icon:'fontColor'}
    if(tool==='note')return {label:'note_color',icon:property}
    if(tool==='pin')return {label:'pin_color',icon:property}
    if(tool==='highlight'||tool==='text-highlight')return {label:'highlight_color',icon:property}
    if(tool==='pen')return {label:'drawing_color',icon:property}
    if(tool&&['rectangle','ellipse','polygon','cloudy-polygon','line','arrow','polyline'].includes(tool))return {label:'stroke_color',icon:property}
    return {label:'color',icon:property}
}
