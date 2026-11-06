export interface ViewerBookmark{readonly id:string;readonly title:string;readonly pageIndex:number}
export function normalizeBookmarks(value:readonly ViewerBookmark[],pageCount:number):readonly ViewerBookmark[]{
    if(!Array.isArray(value)||value.length>2000)throw new RangeError('Invalid bookmark count')
    const ids=new Set<string>()
    return Object.freeze(value.map(item=>{
        if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.title!=='string'||!item.title.trim()||new TextEncoder().encode(item.title).length>512||!Number.isInteger(item.pageIndex)||item.pageIndex<0||item.pageIndex>=pageCount)throw new RangeError('Invalid bookmark')
        ids.add(item.id);return Object.freeze({id:item.id,title:item.title,pageIndex:item.pageIndex})
    }))
}
