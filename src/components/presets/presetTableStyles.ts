export const presetsTableStyles = {
  wrapper: 'relative overflow-x-auto bg-white shadow ring-1 ring-black ring-opacity-5 rounded-md max-w-4xl',
  table: 'min-w-full divide-y divide-gray-300 text-sm',
  headerRow: 'bg-gray-50',
  headerCell: 'py-2 pl-3 pr-2 text-left font-semibold text-gray-900 sm:pl-4',
  headerCellCompact: 'px-2 py-2 text-left font-semibold text-gray-900',
  body: 'divide-y divide-gray-200 bg-white',
}

export const presetsActionMenuStyles = {
  wrapper: 'relative inline-flex justify-end',
  button:
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed',
  panel:
    'absolute right-0 top-full mt-2 w-32 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-10',
  item: 'flex w-full items-center px-3 py-2 text-xs text-gray-700 hover:bg-gray-50',
}
