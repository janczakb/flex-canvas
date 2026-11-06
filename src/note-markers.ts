import type {NoteIcon} from './types.js'
import commentSVG,{paths as commentPaths} from './icons/note-comment.js'
import pointerSVG,{paths as pointerPaths} from './icons/note-pointer.js'
import arrowSVG,{paths as arrowPaths} from './icons/note-arrow.js'
import checkSVG,{paths as checkPaths} from './icons/note-check.js'
import circleSVG,{paths as circlePaths} from './icons/note-circle.js'
import crossSVG,{paths as crossPaths} from './icons/note-cross.js'
import noteSVG,{paths as notePaths} from './icons/note-note.js'
import helpSVG,{paths as helpPaths} from './icons/note-help.js'
import starSVG,{paths as starPaths} from './icons/note-star.js'
import keySVG,{paths as keyPaths} from './icons/note-key.js'

export const noteMarkers:Partial<Record<NoteIcon,{svg:string;paths:readonly string[]}>>={
    comment:{svg:commentSVG,paths:commentPaths},
    pointer:{svg:pointerSVG,paths:pointerPaths},
    arrow:{svg:arrowSVG,paths:arrowPaths},
    check:{svg:checkSVG,paths:checkPaths},
    circle:{svg:circleSVG,paths:circlePaths},
    cross:{svg:crossSVG,paths:crossPaths},
    note:{svg:noteSVG,paths:notePaths},
    help:{svg:helpSVG,paths:helpPaths},
    star:{svg:starSVG,paths:starPaths},
    key:{svg:keySVG,paths:keyPaths},
}
export const defaultNoteIcons:readonly NoteIcon[]=Object.freeze(Object.keys(noteMarkers) as NoteIcon[])
