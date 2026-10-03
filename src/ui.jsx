const icon = (d) => (props) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d={d} />
  </svg>
)
export const TrashIcon = icon('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')
export const PencilIcon = icon('M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4')

export function IconButton({ label, danger, onClick, disabled, children }) {
  return (
    <button type="button" className={'icon' + (danger ? ' danger' : '')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
export const CameraIcon = icon('M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z')
export const PlusIcon = icon('M12 5v14M5 12h14')
export const MinusIcon = icon('M5 12h14')
export const FitIcon = icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')
export const PinIcon = icon('M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8a2.2 2.2 0 1 0 0 4.4A2.2 2.2 0 0 0 12 8z')
export const RulerIcon = icon('M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2')
export const EyeIcon = icon('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z')
export const EyeOffIcon = icon('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 4l16 16')
export const LayersIcon = icon('M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5')
export const ListIcon = icon('M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01')
export const ChevronUpIcon = icon('M6 15l6-6 6 6')
export const ChevronDownIcon = icon('M6 9l6 6 6-6')
export const ImageIcon = icon('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01')
export const FilePlusIcon = icon('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6')
