import {Checkbox} from '@heroui/react/checkbox'
import { Button } from '@heroui/react/button'
import { ColorPicker } from '@heroui/react/color-picker'
import { ColorSwatch } from '@heroui/react/color-swatch'
import { ColorSwatchPicker } from '@heroui/react/color-swatch-picker'
import { Dropdown } from '@heroui/react/dropdown'
import {TextArea} from '@heroui/react/textarea'
import { Input } from '@heroui/react/input'
import { ListBox } from '@heroui/react/list-box'
import { Select } from '@heroui/react/select'
import {Radio} from '@heroui/react/radio'
import {RadioGroup} from '@heroui/react/radio-group'
import {ViewerTooltips} from './tooltips.js'
import {useOverlayDismissal} from './overlay-dismissal.js'
import {OverlayTriggerStateContext} from 'react-aria-components/Dialog'
import {useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider'
import { enableShadowDOM } from 'react-stately/private/flags/flags'
import { viewerIcons } from './viewer-icons.js'
import {noteMarkerSVG} from './notes.js'
import type {NoteIcon} from './types.js'

type MenuEntry = { key: string; label: string; checked?: boolean; action: () => void }
type Choice = { key: string; label: string }

function Icon({name}: {name: string}) {
    const svg = viewerIcons[name]
    return svg ? <span className="fm-hero-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} /> : null
}

function ToolbarMenu({ label, icon, entries }: {label: string; icon: string; entries: () => readonly MenuEntry[]}) {
    const [open, setOpen] = useState(false)
    const trigger=useRef<HTMLButtonElement>(null),pending=useRef<{view:Window;frame:number}|null>(null)
    const popover=useRef<HTMLDivElement>(null)
    const cancelPending=()=>{if(pending.current){pending.current.view.cancelAnimationFrame(pending.current.frame);pending.current=null}}
    useEffect(()=>cancelPending,[])
    const changeOpen=(next:boolean)=>{
        cancelPending()
        if(!next){setOpen(false);return}
        const view=trigger.current?.ownerDocument.defaultView
        if(!view)return
        // Commit after the trigger's automatic scroll-into-view has dispatched its scroll event.
        // React Aria correctly closes an already-open non-modal popover on ancestor scroll.
        pending.current={view,frame:view.requestAnimationFrame(()=>{pending.current=null;setOpen(true)})}
    }
    const dismissal = useOverlayDismissal(open, trigger, popover, () => changeOpen(false))
    const items = entries()
    const selection = items.filter(item => item.checked).map(item => item.key)
    const selectable = items.some(item => item.checked !== undefined)
    return (
        <Dropdown isOpen={open} onOpenChange={changeOpen}>
                <Button {...dismissal} ref={trigger} className="fm-tool" aria-label={label} isIconOnly variant="ghost">
                    <Icon name={icon} />
                </Button>
            <Dropdown.Popover ref={popover} isNonModal placement="bottom start" className="fm-hero-popover">
                <Dropdown.Menu aria-label={label} items={items} selectionMode={selectable ? 'single' : 'none'} selectedKeys={selection}>
                    {item => (
                        <Dropdown.Item id={item.key} textValue={item.label} onAction={() => {changeOpen(false);item.action()}}>
                            <Icon name={item.key} />
                            <span className="fm-menu-label">{item.label}</span>
                            {selectable && <Dropdown.ItemIndicator><Icon name="check" /></Dropdown.ItemIndicator>}
                        </Dropdown.Item>
                    )}
                </Dropdown.Menu>
            </Dropdown.Popover>
        </Dropdown>
    )
}

function PalettePopover({label, choices, noColor, disabled}: {label: string; choices: readonly Choice[]; noColor: boolean; disabled?: boolean}) {
    const state = useContext(OverlayTriggerStateContext)!
    const trigger = useRef<HTMLButtonElement>(null)
    const popover = useRef<HTMLDivElement>(null)
    const dismissal = useOverlayDismissal(state.isOpen, trigger, popover, state.close)
    return <>
        <ColorPicker.Trigger isDisabled={disabled} {...dismissal} ref={trigger} aria-label={label} data-no-color={noColor || undefined}>
            <ColorSwatch />
        </ColorPicker.Trigger>
        <ColorPicker.Popover ref={popover} isNonModal className="fm-hero-popover">
        <ColorSwatchPicker aria-label={label}>
            {choices.map(choice => (
                <ColorSwatchPicker.Item key={choice.key} color={choice.key === 'none' ? '#00000000' : choice.key} aria-label={choice.label} onPress={() => state.close()}>
                    <ColorSwatchPicker.Swatch />
                    <ColorSwatchPicker.Indicator />
                </ColorSwatchPicker.Item>
            ))}
        </ColorSwatchPicker>
        </ColorPicker.Popover>
    </>
}

function Palette({ label, value, choices, onChange, disabled }: {label: string; value: string; choices: readonly Choice[]; onChange: (value: string) => void; disabled?: boolean}) {
    const transparent = '#00000000'
    return (
        <ColorPicker value={value === 'none' ? transparent : value} onChange={color => {
            const hex = color.toString('hex').toLowerCase()
            const selected = color.getChannelValue('alpha') === 0 ? 'none' : choices.find(choice => choice.key.toLowerCase() === hex)?.key
            if (selected) onChange(selected)
        }}>
            <PalettePopover label={label} choices={choices} noColor={value === 'none'} disabled={disabled}/>
        </ColorPicker>
    )
}

function ToolbarSelect({ label, value, choices, onChange, disabled }: {label: string; value: string; choices: readonly Choice[]; onChange: (value: string) => void; disabled?: boolean}) {
    const [open, setOpen] = useState(false)
    const trigger = useRef<HTMLButtonElement>(null), popover = useRef<HTMLDivElement>(null)
    const dismissal = useOverlayDismissal(open, trigger, popover, () => setOpen(false))
    return (
        <Select isDisabled={disabled} isOpen={open} onOpenChange={setOpen} aria-label={label} value={value} onChange={key => {if (key != null) {setOpen(false);onChange(String(key))}}}>
            <Select.Trigger {...dismissal} ref={trigger} aria-label={label}><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover ref={popover} isNonModal placement="bottom start" className="fm-hero-popover">
                <ListBox aria-label={label} items={choices}>
                    {choice => <ListBox.Item id={choice.key} textValue={choice.label}>{choice.label}<ListBox.ItemIndicator /></ListBox.Item>}
                </ListBox>
            </Select.Popover>
        </Select>
    )
}

/** Keep controlled typing in React's event commit, not a later toolbar animation frame. */
function ToolbarInput({properties}:{properties:ComponentProps<typeof Input>}){
    const [value,setValue]=useState(properties.value)
    useLayoutEffect(()=>{setValue(properties.value)},[properties.value])
    return <Input {...properties} value={properties.value===undefined?undefined:value} onChange={event=>{
        if(properties.value!==undefined)setValue(event.currentTarget.value)
        properties.onChange?.(event)
    }}/>
}

export function createHeroControls(viewer: HTMLElement) {
    enableShadowDOM()
    const doc = viewer.ownerDocument
    const renderer = doc.createElement('div'), overlay = doc.createElement('div')
    renderer.className = 'fm-hero-renderer'
    overlay.className = 'fm-hero-overlays'
    viewer.append(renderer, overlay)
    const root = createRoot(renderer)
    const portals = new Map<HTMLElement, () => ReactNode>()
    let id = 0, frame = 0, disposed = false
    const win = doc.defaultView!
    const content = () => (
        <UNSAFE_PortalProvider getContainer={() => overlay}>
            <ViewerTooltips viewer={viewer}/>
            {[...portals].map(([slot, element]) => createPortal(element(), slot, slot.dataset.heroSlot))}
        </UNSAFE_PortalProvider>
    )
    const register = (slot: HTMLElement, element: () => ReactNode) => {
        slot.dataset.heroSlot = String(++id)
        portals.set(slot, element)
    }
    return {
        dropdown(slot: HTMLElement, options: () => ComponentProps<typeof ToolbarMenu>) {
            register(slot, () => <ToolbarMenu {...options()} />)
        },
        toggle(slot: HTMLElement, options: () => {label: string; icon: string; active: boolean; disabled?:boolean; action: () => void}) {
            register(slot, () => {
                const {label, icon, active, disabled, action} = options()
                return <>
                    <Button aria-label={label} aria-pressed={active} isDisabled={disabled} isIconOnly size="sm" variant="ghost" onPress={action}>
                        <Icon name={icon} />
                    </Button>
                </>
            })
        },
        action(slot:HTMLElement, options:()=>{label:string;disabled?:boolean;variant?:ComponentProps<typeof Button>['variant'];size?:ComponentProps<typeof Button>['size'];type?:'submit'|'button';action?:()=>void}) {
            register(slot,()=>{const item=options();return <Button type={item.type} size={item.size??'sm'} variant={item.variant} isDisabled={item.disabled} onPress={item.action}>{item.label}</Button>})
        },
        checkbox(slot:HTMLElement,options:()=>{label:string;selected:boolean;disabled?:boolean;onChange:(value:boolean)=>void}) {
            register(slot,()=>{const item=options();return <Checkbox isSelected={item.selected} isDisabled={item.disabled} onChange={item.onChange}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control>{item.label}</Checkbox.Content></Checkbox>})
        },
        textarea(slot:HTMLElement,props:()=>ComponentProps<typeof TextArea>){
            register(slot,()=> <TextArea {...props()}/>)
        },
        release(slot:HTMLElement){portals.delete(slot);if(!disposed)flushSync(()=>root.render(content()))},
        removeSlots(slots:readonly HTMLElement[]){for(const slot of slots)portals.delete(slot);this.update()},
        input(slot: HTMLElement, props: () => ComponentProps<typeof Input>) {
            register(slot, () => <ToolbarInput properties={props()} />)
        },
        choice(slot: HTMLElement, options: () => ComponentProps<typeof ToolbarSelect>, palette: boolean) {
            register(slot, () => palette ? <Palette {...options()} /> : <ToolbarSelect {...options()} />)
        },
        noteChoices(slot:HTMLElement, options:()=>ComponentProps<typeof ToolbarSelect>, icons:boolean) {
            register(slot,()=>{
                const {label,value,choices,onChange}=options()
                return <RadioGroup className={icons?'fm-note-icons':'fm-note-colors'} aria-label={label} orientation="horizontal" value={value} onChange={onChange}>
                    {choices.map(choice=><Radio className="fm-note-choice" value={choice.key} key={choice.key} aria-label={choice.label}>
                            <Radio.Content className="fm-note-choice-button" aria-label={choice.label}>
                                {icons?<span className="fm-note-glyph" aria-hidden="true" dangerouslySetInnerHTML={{__html:noteMarkerSVG(choice.key as NoteIcon)}}/>:
                                    <span className="fm-note-color" aria-hidden="true" style={{backgroundColor:choice.key}}/>}
                            </Radio.Content>
                    </Radio>)}
                </RadioGroup>
            })
        },
        commit() { flushSync(() => root.render(content())) },
        update() {
            if (disposed || frame) return
            frame = win.requestAnimationFrame(() => { frame = 0; if (!disposed) root.render(content()) })
        },
        destroy() {
            if (disposed) return
            disposed = true
            win.cancelAnimationFrame(frame)
            root.unmount()
            portals.clear()
        },
    }
}
