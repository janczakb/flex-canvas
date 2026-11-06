export type ViewerZoomMode='fit-page'|'fit-width'|'custom'
export interface ViewerZoomOptions {
    mode?:Exclude<ViewerZoomMode,'custom'>
    level?:number
    min?:number
    max?:number
}
export function createViewerZoom(options:ViewerZoomOptions={}){
    const min=options.min??.05,max=options.max??16
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<min||max>16)throw new RangeError('Invalid zoom limits')
    if(options.mode!==undefined&&!['fit-page','fit-width'].includes(options.mode))throw new RangeError('Invalid zoom mode')
    let mode:ViewerZoomMode=options.level===undefined?options.mode??'fit-page':'custom',level=options.level??1
    const bounded=(value:number)=>Math.min(max,Math.max(min,value))
    if(!Number.isFinite(level)||level<=0)throw new RangeError('Invalid zoom level')
    level=bounded(level)
    return {
        get mode(){return mode},
        get level(){return level},
        resolve(fitPage:number,fitWidth:number){return bounded(mode==='fit-page'?fitPage:mode==='fit-width'?fitWidth:level)},
        set(value:Exclude<ViewerZoomMode,'custom'>|number){
            if(typeof value==='number'){
                if(!Number.isFinite(value)||value<=0)throw new RangeError('Invalid zoom level')
                mode='custom';level=bounded(value)
            }else{
                if(!['fit-page','fit-width'].includes(value))throw new RangeError('Invalid zoom mode')
                mode=value
            }
        },
    }
}
export type ViewerZoom=ReturnType<typeof createViewerZoom>
