declare module 'pdfjs-dist/legacy/build/pdf' {
  export const getDocument: any
  export const GlobalWorkerOptions: any
  export type TextItem = { str: string }
}

declare module 'pdfjs-dist/legacy/build/pdf.worker?url' {
  const workerSrc: string
  export default workerSrc
}


