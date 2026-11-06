import { PDFEngineError, defaultPDFLimits, type PDFLimits, type PDFValue, type PDFDictionary } from './types.js'
const white = (byte: number): boolean => [0, 9, 10, 12, 13, 32].includes(byte)
const delimiter = (byte: number): boolean => white(byte) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(byte)
const latin1 = (bytes: Uint8Array): string => {let result='';for(const byte of bytes)result+=String.fromCharCode(byte);return result}

/** Independent byte tokenizer. Offsets remain binary offsets; PDF is never decoded as one UTF-8 string. */
export class PDFTokenizer {
    private offset: number
    private tokens = 0
    private readonly limits: PDFLimits
    constructor(private readonly bytes: Uint8Array, offset = 0, limits: Partial<PDFLimits> = {}) {
        this.limits = Object.freeze({...defaultPDFLimits,...limits})
        for(const value of Object.values(this.limits))if(!Number.isSafeInteger(value)||value<1)throw new PDFEngineError('invalid_budget','PDF budgets require positive integers.')
        if(bytes.length>this.limits.maxBytes)throw new PDFEngineError('byte_limit','PDF exceeds its byte limit.')
        if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length)throw new PDFEngineError('invalid_offset','Invalid PDF byte offset.')
        this.offset=offset
    }
    get position(): number {return this.offset}
    private error(code: string, message: string): never {throw new PDFEngineError(code,`${message} (byte ${this.offset})`)}
    skip(): void {
        while(this.offset<this.bytes.length){
            const byte=this.bytes[this.offset]
            if(white(byte)){this.offset++;continue}
            if(byte===37){while(this.offset<this.bytes.length&&![10,13].includes(this.bytes[this.offset]))this.offset++;continue}
            break
        }
    }
    private token(): void {if(++this.tokens>this.limits.maxTokens)this.error('token_limit','PDF token budget exceeded')}
    private word(): string {
        this.skip();const start=this.offset
        while(this.offset<this.bytes.length&&!delimiter(this.bytes[this.offset]))this.offset++
        if(this.offset===start)this.error('unexpected_delimiter','Unexpected PDF delimiter')
        return latin1(this.bytes.subarray(start,this.offset))
    }
    keyword(): string {this.token();return this.word()}
    expect(keyword: string): void {if(this.keyword()!==keyword)this.error('unexpected_keyword','Unexpected PDF keyword')}
    private number(word: string): number {
        if(!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word))this.error('invalid_number','Invalid PDF number')
        const value=Number(word)
        if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)this.error('number_limit','PDF number exceeds precision limits')
        return value
    }
    private name(): PDFValue {
        this.offset++;const result:number[]=[]
        while(this.offset<this.bytes.length&&!delimiter(this.bytes[this.offset])){
            let byte=this.bytes[this.offset++]
            if(byte===35){const hex=latin1(this.bytes.subarray(this.offset,this.offset+2));if(!/^[0-9a-f]{2}$/i.test(hex))this.error('invalid_name','Invalid escaped PDF name');byte=parseInt(hex,16);this.offset+=2}
            result.push(byte);if(result.length>this.limits.maxStringBytes)this.error('string_limit','PDF name is too long')
        }
        return Object.freeze({kind:'name',value:latin1(new Uint8Array(result))})
    }
    private literal(): PDFValue {
        this.offset++;let depth=1;const result:number[]=[]
        while(this.offset<this.bytes.length){
            let byte=this.bytes[this.offset++]
            if(byte===92){
                if(this.offset>=this.bytes.length)this.error('truncated_string','Incomplete PDF escape')
                byte=this.bytes[this.offset++]
                if(byte===13){if(this.bytes[this.offset]===10)this.offset++;continue}
                if(byte===10)continue
                const escaped:Record<number,number>={110:10,114:13,116:9,98:8,102:12}
                if(byte>=48&&byte<=55){let octal=String.fromCharCode(byte);for(let i=0;i<2&&this.bytes[this.offset]>=48&&this.bytes[this.offset]<=55;i++)octal+=String.fromCharCode(this.bytes[this.offset++]);byte=parseInt(octal,8)&255}
                else byte=escaped[byte]??byte
            }else if(byte===40){if(++depth>this.limits.maxDepth)this.error('depth_limit','PDF string nesting limit exceeded')}
            else if(byte===41&&--depth===0)return Object.freeze({kind:'string',bytes:new Uint8Array(result)})
            else if(byte===13){if(this.bytes[this.offset]===10)this.offset++;byte=10}
            result.push(byte);if(result.length>this.limits.maxStringBytes)this.error('string_limit','PDF string exceeds its byte limit')
        }
        return this.error('truncated_string','Unterminated PDF literal string')
    }
    private hex(): PDFValue {
        this.offset++;let high:number|undefined;const result:number[]=[]
        while(this.offset<this.bytes.length){const byte=this.bytes[this.offset++];if(white(byte))continue
            if(byte===62){if(high!==undefined)result.push(high<<4);return Object.freeze({kind:'string',bytes:new Uint8Array(result)})}
            const char=String.fromCharCode(byte);if(!/^[0-9a-f]$/i.test(char))this.error('invalid_hex','Invalid PDF hexadecimal string')
            const nibble=parseInt(char,16);if(high===undefined)high=nibble;else{result.push((high<<4)|nibble);high=undefined}
            if(result.length>this.limits.maxStringBytes)this.error('string_limit','PDF hex string exceeds its byte limit')
        }
        return this.error('truncated_string','Unterminated PDF hexadecimal string')
    }
    read(depth=0): PDFValue {
        this.skip();this.token();if(depth>this.limits.maxDepth)this.error('depth_limit','PDF nesting limit exceeded')
        const byte=this.bytes[this.offset];if(byte===undefined)this.error('unexpected_eof','Unexpected PDF end')
        if(byte===47)return this.name()
        if(byte===40)return this.literal()
        if(byte===60&&this.bytes[this.offset+1]!==60)return this.hex()
        if(byte===60){this.offset+=2;const entries=new Map<string,PDFValue>();while(true){this.skip();if(this.bytes[this.offset]===62&&this.bytes[this.offset+1]===62){this.offset+=2;return Object.freeze({kind:'dictionary',entries}) satisfies PDFDictionary}
                const key=this.read(depth+1);if(!key||typeof key!=='object'||!('kind' in key)||key.kind!=='name')this.error('invalid_dictionary','PDF dictionary keys must be names')
                if(entries.has(key.value))this.error('duplicate_key','Duplicate PDF dictionary key');entries.set(key.value,this.read(depth+1));if(entries.size>this.limits.maxArrayItems)this.error('array_limit','PDF dictionary limit exceeded')}}
        if(byte===91){this.offset++;const values:PDFValue[]=[];while(true){this.skip();if(this.bytes[this.offset]===93){this.offset++;return Object.freeze(values)}if(values.length>=this.limits.maxArrayItems)this.error('array_limit','PDF array limit exceeded');values.push(this.read(depth+1))}}
        const word=this.word();if(word==='true')return true;if(word==='false')return false;if(word==='null')return null
        const value=this.number(word)
        if(Number.isInteger(value)&&value>=0){const after=this.offset;this.skip();if(this.offset<this.bytes.length&&/[0-9]/.test(String.fromCharCode(this.bytes[this.offset]))){
                const generationWord=this.word();this.skip();if(/^\d+$/.test(generationWord)&&this.bytes[this.offset]===82&&(this.offset+1===this.bytes.length||delimiter(this.bytes[this.offset+1]))){this.offset++;const generation=Number(generationWord);if(value<1||!Number.isInteger(generation)||generation<0||generation>65535)this.error('invalid_reference','Invalid PDF object reference');return Object.freeze({kind:'reference',object:value,generation})}}
            this.offset=after}
        return value
    }
}
