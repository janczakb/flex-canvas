import alignLeft from './icons/alignLeft.js'
import alignCenter from './icons/alignCenter.js'
import alignRight from './icons/alignRight.js'
import alignTop from './icons/alignTop.js'
import alignMiddle from './icons/alignMiddle.js'
import alignBottom from './icons/alignBottom.js'
import documentCrop from './icons/document-crop.js'
import fitPage from './icons/fit-page.js'
import fitWidth from './icons/fit-width.js'
import underline from './icons/property-underline.js'
import fontFamily from './icons/property-font-family.js'
import verticalAlign from './icons/property-vertical-align.js'
import newPageIcon from './icons/new-page.js'
import duplicateIcon from './icons/duplicate.js'
import rotateLeftIcon from './icons/rotate-left.js'
import rotateRightIcon from './icons/rotate-right.js'
import movePagesIcon from './icons/move-pages.js'
import bookmarks from './icons/bookmarks.js'
import signatures from './icons/signatures.js'
import pageDisplay from './icons/page-display.js'
import markup_redaction from './icons/markup-redaction.js'
import markup_squiggle from './icons/markup-squiggle.js'
import markup_underline from './icons/markup-underline.js'
import markup_strikeout from './icons/markup-strikeout.js'
import propertyColor from './icons/property-color.js'
import propertyFontColor from './icons/property-font-color.js'
import drag from './icons/drag.js'
import thumbnails from './icons/thumbnails.js'
import outline from './icons/outline.js'
import more from './icons/more.js'
import propertyFill from './icons/property-fill.js'
import propertyOpacity from './icons/property-opacity.js'
import propertyStroke from './icons/property-stroke.js'
import propertyDash from './icons/property-dash.js'
import propertyStartCap from './icons/property-start-cap.js'
import propertyEndCap from './icons/property-end-cap.js'
import propertyFontSize from './icons/property-font-size.js'
import propertyBold from './icons/property-bold.js'
import propertyItalic from './icons/property-italic.js'
import propertyAlign from './icons/property-align.js'
import propertyBlendMode from './icons/property-blend-mode.js'
import icon0 from './icons/pages.js'
import icon1 from './icons/select.js'
import icon2 from './icons/pan.js'
import icon3 from './icons/prev.js'
import icon4 from './icons/next.js'
import icon5 from './icons/zoom-in.js'
import icon6 from './icons/zoom-out.js'
import icon7 from './icons/search.js'
import icon8 from './icons/edit-pages.js'
import icon9 from './icons/annotations.js'
import icon10 from './icons/print.js'
import icon11 from './icons/download.js'
import icon12 from './icons/undo.js'
import icon13 from './icons/redo.js'
import icon14 from './icons/delete.js'
import icon15 from './icons/close.js'
import icon16 from './icons/tools.js'
import icon17 from './icons/chevron.js'
import icon18 from './icons/pen.js'
import icon19 from './icons/highlight.js'
import icon20 from './icons/text-highlight.js'
import icon21 from './icons/eraser.js'
import icon22 from './icons/pin.js'
import icon23 from './icons/rectangle.js'
import icon24 from './icons/ellipse.js'
import icon25 from './icons/line.js'
import icon26 from './icons/arrow.js'
import icon27 from './icons/polygon.js'
import icon28 from './icons/cloudy-polygon.js'
import icon30 from './icons/text.js'
import icon31 from './icons/callout.js'
import icon32 from './icons/image.js'
import icon33 from './icons/link.js'
import icon34 from './icons/signature.js'
import icon35 from './icons/check.js'

export const viewerIcons: Readonly<Record<string, string>> = {
    content_editor:icon30,document_crop:documentCrop,newPage:newPageIcon,duplicate:duplicateIcon,rotateLeft:rotateLeftIcon,rotateRight:rotateRightIcon,movePages:movePagesIcon,bookmarks,signatures,drag,thumbnails,outline,more,viewMode:pageDisplay,
    markup_highlight:icon20,markup_comment:icon9,
    "markup_redaction":markup_redaction,
    "markup_squiggle":markup_squiggle,
    "markup_underline":markup_underline,
    "markup_strikeout":markup_strikeout,
    noteIcon: icon9, eraserSize: propertyStroke,
    'color': propertyColor,
    'fontColor': propertyFontColor,
    'fill': propertyFill,
    'opacity': propertyOpacity,
    'stroke': propertyStroke,
    'dash': propertyDash,
    'startCap': propertyStartCap,
    'endCap': propertyEndCap,
    'fontSize': propertyFontSize,
    'bold': propertyBold,
    'italic': propertyItalic,underline,fontFamily,verticalAlign,strokeColor:propertyColor,
    'align': propertyAlign,
    'blendMode': propertyBlendMode,
    "pages": icon0,
    "select": icon1,
    "pan": icon2,
    "prev": icon3,
    "next": icon4,
    "zoomIn": icon5,
    "zoomOut": icon6,
    "search": icon7,
    "edit-pages": icon8,
    "annotations": icon9,
    "print": icon10,
    "download": icon11,
    "undo": icon12,
    "redo": icon13,
    "delete": icon14,
    "clear": icon14,
    "close": icon15,
    "tools": icon16,
    "chevron": icon17,
    "pen": icon18,
    "highlight": icon19,
    "text-highlight": icon20,
    "eraser": icon21,
    "note": icon9,
    "pin": icon22,
    "rectangle": icon23,
    "ellipse": icon24,
    "line": icon25,
    "arrow": icon26,
    "polygon": icon27,
    "cloudy-polygon": icon28,
    "polyline": markup_squiggle,
    "text": icon30,
    "callout": icon31,
    "image": icon32,
    "link": icon33,
    "signature": icon34,
    "check": icon35,
    "cancel": icon15,
    "fit": fitPage,fitPage,fitWidth,alignLeft,alignCenter,alignRight,alignTop,alignMiddle,alignBottom,
}

export function paintViewerIcon(button: HTMLElement, key: string): boolean {
    const svg = viewerIcons[key]
    if (!svg) return false
    button.innerHTML = svg
    button.firstElementChild?.setAttribute('aria-hidden', 'true')
    if (key === 'line') button.firstElementChild?.classList.add('fm-diagonal')
    return true
}
