import { useEffect, useRef } from "react"
import {EditorView, basicSetup} from  "codemirror"
import{javascript} from "@codemirror/lang-javascript"
export const CodeEditor = ()=>{
    const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView |null>(null)

  useEffect(()=>{
    if(!editorRef.current) return
const view = new EditorView({
    doc:"Start document",
    parent: editorRef.current,
    extensions:[
        basicSetup,
        javascript({typescript:true})
    ]
})
viewRef.current = view
return ()=>{
    view.destroy()
}
  },[])
    return(
        <div ref={editorRef} className="size-full pl-4 bg-background"/>

       
    )
}