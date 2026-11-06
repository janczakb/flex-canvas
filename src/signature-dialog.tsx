import {Button} from '@heroui/react/button'
import {Input} from '@heroui/react/input'
import {Tabs} from '@heroui/react/tabs'
import {Modal} from '@heroui/react/modal'
import {ColorSwatchPicker} from '@heroui/react/color-swatch-picker'
import {Spinner} from '@heroui/react/spinner'
import {UNSAFE_PortalProvider} from 'react-aria/PortalProvider'
import {Radio} from '@heroui/react/radio'
import {RadioGroup} from '@heroui/react/radio-group'
import {useEffect, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {imageAnnotationAsset, type InsertData, type InsertOptions} from './insertion.js'
import {acquireSignatureFonts, signatureFonts} from './signature-fonts.js'

type Mode = 'draw' | 'image' | 'type'
type Point = readonly [number, number]
const colors = [['#000000', 'signature_black'], ['#1e3a8a', 'signature_dark_blue'], ['#701f36', 'signature_claret']] as const
const width = 1200, height = 480

function cropSignature(canvas: HTMLCanvasElement): {asset: string; aspectRatio: number} {
    const context = canvas.getContext('2d', {willReadFrequently: true})!
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    if (right < left) throw new Error('Empty signature')
    const output = canvas.ownerDocument.createElement('canvas'), padding = 10
    output.width = right - left + 1 + padding * 2; output.height = bottom - top + 1 + padding * 2
    output.getContext('2d')!.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1)
    const asset = output.toDataURL('image/png')
    if (asset.length > 196608) throw new Error('Signature too large')
    return {asset, aspectRatio: output.width / output.height}
}

function SignatureEditor({options, finish}: {options: InsertOptions; finish: (data: InsertData | null) => void}) {
    const {owner, signal, labels = {}} = options, document = owner.ownerDocument
    const label = (key: string) => labels[key] ?? key
    const [mode, setMode] = useState<Mode>('draw'), [color, setColor] = useState<string>(colors[0][0])
    const [drawn, setDrawn] = useState(false), [text, setText] = useState(''), [font, setFont] = useState<string>(signatureFonts[0])
    const [image, setImage] = useState<InsertData | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const [fontsReady, setFontsReady] = useState(false)
    const canvas = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null)
    const strokes = useRef<Point[][]>([]), pointer = useRef<number | null>(null), mounted = useRef(true), request = useRef(0)
    const frame = useRef(0), view = document.defaultView!
    const paint = () => {
        frame.current = 0
        const node = canvas.current
        if (!node) return
        const rect = node.getBoundingClientRect(), ratio = Math.min(3, Math.max(2, view.devicePixelRatio || 1))
        const pixelWidth = Math.max(1, Math.round(rect.width * ratio)), pixelHeight = Math.max(1, Math.round(rect.height * ratio))
        if (node.width !== pixelWidth || node.height !== pixelHeight) {node.width = pixelWidth; node.height = pixelHeight}
        const context = node.getContext('2d')!
        const pixel = (point: Point): [number, number] => [point[0] * node.width, point[1] * node.height]
        context.clearRect(0, 0, node.width, node.height)
        context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 2 * ratio; context.lineCap = 'round'; context.lineJoin = 'round'
        for (const points of strokes.current) {
            if (!points.length) continue
            context.beginPath(); context.moveTo(...pixel(points[0]))
            for (let index = 1; index < points.length; index++) {
                const previous = pixel(points[index - 1]), point = pixel(points[index])
                context.quadraticCurveTo(previous[0], previous[1], (previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2)
            }
            context.lineTo(...pixel(points[points.length - 1])); context.stroke()
            if (points.length === 1) {context.beginPath(); context.arc(...pixel(points[0]), ratio, 0, Math.PI * 2); context.fill()}
        }
    }
    const repaint = () => {if (!frame.current) frame.current = view.requestAnimationFrame(paint)}
    useEffect(() => {
        view.cancelAnimationFrame(frame.current); frame.current = 0; paint()
        if (!canvas.current) return
        const observer = new ResizeObserver(repaint)
        observer.observe(canvas.current)
        return () => observer.disconnect()
    }, [color, mode])
    useEffect(() => () => {mounted.current = false; request.current++; view.cancelAnimationFrame(frame.current)}, [])
    useEffect(() => {
        if (mode !== 'type') return
        let active = true
        const fonts = acquireSignatureFonts(document, options.assetBaseUrl)
        setFontsReady(false)
        fonts.ready.then(() => {if (active) setFontsReady(true)}, () => {if (active) setError(label('signature_fonts_error'))})
        return () => {active = false; fonts.release()}
    }, [mode])
    const position = (event: {clientX: number; clientY: number}): Point => {
        const rect = canvas.current!.getBoundingClientRect()
        return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]
    }
    const loadImage = async (file?: File) => {
        if (!file) return
        const current = ++request.current
        setBusy(true); setError('')
        try {
            const asset = await imageAnnotationAsset(file, document)
            const preview = document.createElement('img'); preview.src = asset; await preview.decode()
            if (mounted.current && current === request.current) setImage({asset, aspectRatio: preview.naturalWidth / preview.naturalHeight})
        } catch {if (mounted.current && current === request.current) setError(label('signature_image_error'))}
        finally {if (mounted.current && current === request.current) setBusy(false)}
    }
    const submit = async () => {
        if (busy || signal?.aborted || !ready) return
        setBusy(true); setError('')
        try {
            if (mode === 'image') {if (image) finish(image); return}
            if (mode === 'draw') {paint(); finish(cropSignature(canvas.current!)); return}
            await document.fonts.load(`400 64px "FM Signature ${font}"`, text)
            if (!mounted.current || signal?.aborted) return
            const output = document.createElement('canvas'); output.width = width; output.height = 240
            const context = output.getContext('2d')!
            context.font = `400 100px "FM Signature ${font}"`
            context.fillStyle = color; context.textBaseline = 'middle'
            context.fillText(text.trim(), 40, 120, width - 80)
            finish(cropSignature(output))
        } catch {if (mounted.current) setError(label('insert_invalid'))}
        finally {if (mounted.current) setBusy(false)}
    }
    const ready = mode === 'draw' ? drawn : mode === 'image' ? !!image : fontsReady && !!text.trim()
    const clearImage = () => {
        request.current++; setImage(null); setBusy(false); setError('')
        if (input.current) input.current.value = ''
    }
    const palette = <div className="fm-signature-palette">
        <ColorSwatchPicker size="sm" aria-label={label(mode === 'type' ? 'font_color' : 'drawing_color')} value={color} onChange={value => setColor(value.toString('hex'))}>
            {colors.map(([value, name]) => <ColorSwatchPicker.Item key={value} color={value} aria-label={label(name)}>
                <ColorSwatchPicker.Swatch/><ColorSwatchPicker.Indicator/>
            </ColorSwatchPicker.Item>)}
        </ColorSwatchPicker>
    </div>
    return <form className="fm-signature-form" onSubmit={event => {event.preventDefault(); void submit()}}>
        <Modal.Header className="fm-signature-header"><Modal.Heading>{label('signature_title')}</Modal.Heading></Modal.Header>
        <Modal.Body className="fm-signature-body">
        <Tabs className="fm-signature-tabs" selectedKey={mode} onSelectionChange={key => {setMode(key as Mode); if(key==='type')setFontsReady(false); setError('')}} variant="secondary">
            <Tabs.ListContainer><Tabs.List aria-label={label('signature_modes')}>
                <Tabs.Tab id="draw">{label('signature_draw')}<Tabs.Indicator/></Tabs.Tab>
                <Tabs.Tab id="image">{label('image')}<Tabs.Indicator/></Tabs.Tab>
                <Tabs.Tab id="type">{label('signature_type')}<Tabs.Indicator/></Tabs.Tab>
            </Tabs.List></Tabs.ListContainer>
            <Tabs.Panel id="draw" className="fm-signature-panel">
                {palette}
                <div className="fm-signature-workspace">
                    <canvas ref={canvas} width={width} height={height} aria-label={label('signature_draw_canvas')} onPointerDown={event => {
                        if (event.button !== 0 || pointer.current !== null || strokes.current.reduce((count, stroke) => count + stroke.length, 0) >= 20000) return
                        pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
                        strokes.current.push([position(event)]); setDrawn(true); repaint()
                    }} onPointerMove={event => {
                        if (pointer.current !== event.pointerId) return
                        const stroke = strokes.current[strokes.current.length - 1]
                        if (stroke.length >= 10000) return
                        const samples = event.nativeEvent.getCoalescedEvents?.()
                        for (const point of samples?.length ? samples : [event.nativeEvent]) stroke.push(position(point))
                        repaint()
                    }} onPointerUp={event => {
                        if (pointer.current === event.pointerId) {pointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); repaint()}
                    }} onLostPointerCapture={() => {pointer.current = null}}>{label('signature_draw_canvas')}</canvas>
                    <div className="fm-signature-helper-row">
                        {drawn ? <Button variant="secondary" size="sm" onPress={() => {strokes.current = []; setDrawn(false); paint()}}>{label('clear_signature')}</Button> : <span>{label('signature_sign_here')}</span>}
                    </div>
                </div>
            </Tabs.Panel>
            <Tabs.Panel id="image" className="fm-signature-panel fm-signature-image">
                <div className="fm-signature-workspace">
                    <label className="fm-signature-drop" data-loaded={!!image?.asset || undefined} aria-busy={busy} onPaste={event => {
                        const file = Array.from(event.clipboardData.items).find(item => item.kind === 'file')?.getAsFile()
                        if (file) {event.preventDefault(); void loadImage(file)}
                    }} onDragOver={event => {
                        if (!event.dataTransfer.types.includes('Files')) return
                        event.preventDefault(); event.currentTarget.dataset.dragging = 'true'
                    }} onDragLeave={event => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) delete event.currentTarget.dataset.dragging
                    }} onDrop={event => {
                        event.preventDefault(); delete event.currentTarget.dataset.dragging; void loadImage(event.dataTransfer.files[0])
                    }}>
                        <input className="fm-signature-file-input" ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={label('signature_select_image')} onChange={event => {void loadImage(event.currentTarget.files?.[0]); event.currentTarget.value = ''}}/>
                        {image?.asset && <img src={image.asset} alt={label('signature_image_preview')}/>}
                        {!image && !busy && <Button size="sm" variant="secondary" excludeFromTabOrder onPress={() => input.current?.click()}>{label('signature_select_image')}</Button>}
                        {busy && <span className="fm-signature-image-loading" role="status" aria-label={label('signature_loading_image')}><Spinner size="sm"/></span>}
                    </label>
                    <div className="fm-signature-helper-row">
                        {image || busy ? <Button variant="secondary" size="sm" onPress={clearImage}>{label('clear_signature')}</Button> : <span>{label('signature_drop_image')}</span>}
                    </div>
                </div>
            </Tabs.Panel>
            <Tabs.Panel id="type" className="fm-signature-panel fm-signature-type" data-fonts-ready={fontsReady}>
                {palette}
                <div className="fm-signature-workspace">
                    <Input className="fm-signature-input" aria-label={label('signature_sign_here')} value={text} maxLength={120} onChange={event => setText(event.currentTarget.value)} placeholder={label('signature_sign_here')} style={{fontFamily: `"FM Signature ${font}"`, color, visibility: fontsReady ? undefined : 'hidden'}}/>
                    {!fontsReady && <span className="fm-signature-font-loading" role="status">{label('signature_loading_fonts')}</span>}
                    <div className="fm-signature-helper-row">
                        {text ? <Button variant="secondary" size="sm" onPress={() => setText('')}>{label('clear_signature')}</Button> : <span>{label('signature_sign_here')}</span>}
                    </div>
                </div>
                <RadioGroup className="fm-signature-fonts" aria-label={label('signature_fonts')} value={font} onChange={setFont}>
                    {signatureFonts.map(name => <Radio key={name} value={name} aria-label={name}><Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control><span className="fm-signature-font-sample" style={{fontFamily: fontsReady ? `"FM Signature ${name}"` : undefined, visibility: fontsReady ? undefined : 'hidden'}}>{text.trim() || label('signature_sample')}</span></Radio.Content></Radio>)}
                </RadioGroup>
            </Tabs.Panel>
        </Tabs>
        {error && <p className="fm-signature-error" role="alert">{error}</p>}
        </Modal.Body>
        <Modal.Footer className="fm-signature-footer">
            <Button type="submit" variant="primary" isDisabled={!ready || busy}>{label('insert_done')}</Button>
        </Modal.Footer>
    </form>
}

/** Unmount only after HeroUI has completed its own exit animation. */
function SignatureExit({complete}: {complete: () => void}) {
    useEffect(() => () => {queueMicrotask(complete)}, [complete])
    return null
}

export function openSignatureDialog(options: InsertOptions): Promise<InsertData | null> {
    if (options.signal?.aborted || options.owner.querySelector(':scope > .fm-signature-mount')) return Promise.resolve(null)
    const document = options.owner.ownerDocument
    const mount = document.createElement('div'), renderer = document.createElement('div'), portal = document.createElement('div')
    mount.className = 'fm-signature-mount'; mount.append(renderer, portal); options.owner.append(mount)
    const root = createRoot(renderer)
    return new Promise((resolve, reject) => {
        let disposed = false, closing = false, result: InsertData | null = null
        const complete = () => {
            if (disposed) return
            disposed = true; options.signal?.removeEventListener('abort', abort)
            root.unmount(); mount.remove(); resolve(result)
        }
        const abort = () => {result = null; complete()}
        const close = (data: InsertData | null) => {
            if (closing || disposed) return
            closing = true; result = data; root.render(content(false))
        }
        const content = (open: boolean) => <UNSAFE_PortalProvider getContainer={() => portal}>
            <Modal isOpen={open} onOpenChange={next => {if (!next) close(null)}}>
                <Modal.Backdrop className="fm-signature-backdrop">
                    <Modal.Container className="fm-signature-container" placement="center" size="lg" scroll="inside">
                        <Modal.Dialog className="fm-signature-dialog" aria-label={options.labels?.signature_title ?? 'Add Signature'}>
                            <Modal.CloseTrigger aria-label={options.labels?.close ?? 'Close'}/>
                            <SignatureExit complete={complete}/>
                            <SignatureEditor options={options} finish={close}/>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal.Backdrop>
            </Modal>
        </UNSAFE_PortalProvider>
        options.signal?.addEventListener('abort', abort, {once: true})
        try {flushSync(() => root.render(content(true)))}
        catch (error) {options.signal?.removeEventListener('abort', abort); root.unmount(); mount.remove(); reject(error)}
    })
}
