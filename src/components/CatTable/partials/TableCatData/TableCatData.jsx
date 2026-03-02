import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TableCatDataLogic } from './TableCatDataLogic.jsx';
import { TableHead } from './partials/TableHead/TableHead.jsx';
import { TableBody } from './partials/TableBody/TableBody.jsx';
import './TableCatData.css';

const MIN_VISIBLE_ROWS = 4;

function parseCssPx(value, fallback) {
	const parsedValue = Number.parseFloat(value);
	return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function getDefaultRowCount() {
	const h = window.innerHeight;
	if (h <= 900) return 4;
	if (h <= 1000) return 5;
	if (h <= 1080) return 6;
	if (h <= 1200) return 8;
	return 9;
}

function computeTableHeightForRows(container, rowCount) {
	const styles = window.getComputedStyle(container);
	const get = (prop) => parseCssPx(styles.getPropertyValue(prop), 0);

	const rowHeight =
		get('--table-row-font-size') * get('--table-row-line-height') +
		get('--table-row-cell-y-padding') * 2 +
		get('--table-row-border-bottom');

	const headerHeight =
		get('--table-header-font-size') * get('--table-header-line-height') +
		get('--table-header-cell-y-padding') * 2 +
		get('--table-header-border-bottom');

	const handleHeight = get('--table-resize-handle-height');

	return headerHeight + rowHeight * rowCount - 6 + handleHeight;
}

export function TableCatData({
	cats,
	activeRoom,
	setActiveRoom,
	hoveredCatId,
	setHoveredCatId,
	handleSort,
	sortCol,
	sortAsc,
	sorted,
	totalStat,
	statFilters,
	setStatFilter,
}) {
	const tableContainerRef = useRef(null);
	const tableRef = useRef(null);
	const resizeHandleRef = useRef(null);
	const resizeStateRef = useRef(null);
	const activeHandlersRef = useRef(null);
	const userPreferredHeightRef = useRef(null);
	const searchTimerRef = useRef(null);

	const [searchQuery, setSearchQuery] = useState('');
	const [highlightedCatId, setHighlightedCatId] = useState(null);

	const { columns, isPartnerInOtherRoom } = TableCatDataLogic({ cats });

	const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

	const executeSearch = useCallback(
		(query) => {
			const normalizedQuery = normalize(query);
			if (!normalizedQuery) {
				setHighlightedCatId(null);
				return;
			}

			const currentRoomMatch = sorted.find((cat) =>
				normalize(cat.name).includes(normalizedQuery)
			);

			if (currentRoomMatch) {
				setHighlightedCatId(currentRoomMatch.id);
				return;
			}

			const fallbackMatch = cats.find((cat) => {
				if (cat.room === activeRoom) return false;

				const normalizedName = normalize(cat.name);
				if (normalizedName === normalizedQuery) return true;

				const nameParts = normalizedName.split(' ');
				if (nameParts.length <= 1) return false;

				return nameParts[0] === normalizedQuery;
			});

			if (!fallbackMatch) {
				setHighlightedCatId(null);
				return;
			}

			setActiveRoom(fallbackMatch.room);
			setHighlightedCatId(fallbackMatch.id);
		},
		[activeRoom, cats, setActiveRoom, sorted]
	);

	const handleSearchChange = useCallback(
		(query) => {
			setSearchQuery(query);
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
			searchTimerRef.current = setTimeout(() => executeSearch(query), 500);
		},
		[executeSearch]
	);

	const handleSearchSubmit = useCallback(
		(query) => {
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
			executeSearch(query);
		},
		[executeSearch]
	);

	useEffect(() => {
		return () => {
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		};
	}, []);

	const getHeightBounds = useCallback((tableContainer) => {
		const computedStyles = window.getComputedStyle(tableContainer);
		const preferredMinHeight = computeTableHeightForRows(tableContainer, MIN_VISIBLE_ROWS);
		const viewportMaxHeight = parseCssPx(computedStyles.maxHeight, Number.POSITIVE_INFINITY);

		const tableEl = tableRef.current;
		const resizeHandle = resizeHandleRef.current;
		const contentHeight = tableEl
			? tableEl.getBoundingClientRect().height
			: Number.POSITIVE_INFINITY;
		const handleHeight = resizeHandle ? resizeHandle.getBoundingClientRect().height : 0;
		const borderBottom = parseCssPx(computedStyles.borderBottomWidth, 0);
		const contentMaxHeight = contentHeight + handleHeight + borderBottom;
		const maxHeight = Math.min(viewportMaxHeight, contentMaxHeight);
		const effectiveMinHeight = Math.min(preferredMinHeight, maxHeight);

		return {
			minHeight: effectiveMinHeight,
			maxHeight,
		};
	}, []);

	const handleResizeMove = useCallback(
		(event) => {
			const tableContainer = tableContainerRef.current;
			const resizeState = resizeStateRef.current;

			if (!tableContainer || !resizeState) return;

			const { minHeight, maxHeight } = getHeightBounds(tableContainer);
			const nextHeight = resizeState.startHeight + (event.clientY - resizeState.startY);
			const clampedHeight = Math.min(maxHeight, Math.max(minHeight, nextHeight));
			const isAtMaxHeight = clampedHeight >= maxHeight - 0.5;

			tableContainer.style.height = `${clampedHeight}px`;
			tableContainer.classList.toggle('is-at-max-height', isAtMaxHeight);
		},
		[getHeightBounds]
	);

	const stopResizing = useCallback(() => {
		const tableContainer = tableContainerRef.current;
		if (tableContainer) {
			userPreferredHeightRef.current = tableContainer.getBoundingClientRect().height;
			tableContainer.classList.remove('is-resizing');
			tableContainer.classList.remove('is-at-max-height');
		}

		resizeStateRef.current = null;
		const handlers = activeHandlersRef.current;
		if (handlers) {
			window.removeEventListener('pointermove', handlers.move);
			window.removeEventListener('pointerup', handlers.stop);
			window.removeEventListener('pointercancel', handlers.stop);
			activeHandlersRef.current = null;
		}
	}, []);

	const handleResizeStart = useCallback(
		(event) => {
			if (event.button !== 0) return;

			event.preventDefault();

			const tableContainer = tableContainerRef.current;
			if (!tableContainer) return;

			const { height } = tableContainer.getBoundingClientRect();

			resizeStateRef.current = {
				startY: event.clientY,
				startHeight: height,
			};

			activeHandlersRef.current = {
				move: handleResizeMove,
				stop: stopResizing,
			};

			tableContainer.classList.add('is-resizing');
			tableContainer.classList.remove('is-at-max-height');
			window.addEventListener('pointermove', handleResizeMove);
			window.addEventListener('pointerup', stopResizing);
			window.addEventListener('pointercancel', stopResizing);
		},
		[handleResizeMove, stopResizing]
	);

	useEffect(() => {
		return () => {
			stopResizing();
		};
	}, [stopResizing]);

	useLayoutEffect(() => {
		const tableContainer = tableContainerRef.current;
		if (!tableContainer) return;

		const { height: currentHeight } = tableContainer.getBoundingClientRect();
		const defaultHeight = computeTableHeightForRows(tableContainer, getDefaultRowCount());

		const { minHeight, maxHeight } = getHeightBounds(tableContainer);
		const targetHeight = userPreferredHeightRef.current ?? defaultHeight;
		const clampedHeight = Math.min(maxHeight, Math.max(minHeight, targetHeight));

		if (Math.abs(clampedHeight - currentHeight) > 0.5) {
			tableContainer.style.height = `${clampedHeight}px`;
		}
	}, [sorted.length, getHeightBounds]);

	return (
		<>
			{/* Table */}
			<section className="table-cat-data" aria-label="Cats table" ref={tableContainerRef}>
				<div className="table-scroll">
					<table className="table" ref={tableRef}>
						<TableHead
							columns={columns}
							handleSort={handleSort}
							sortCol={sortCol}
							sortAsc={sortAsc}
							searchQuery={searchQuery}
							onSearchChange={handleSearchChange}
							onSearchSubmit={handleSearchSubmit}
							statFilters={statFilters}
							setStatFilter={setStatFilter}
						/>
						<TableBody
							cats={cats}
							columns={columns}
							sorted={sorted}
							hoveredCatId={hoveredCatId}
							setHoveredCatId={setHoveredCatId}
							totalStat={totalStat}
							isPartnerInOtherRoom={isPartnerInOtherRoom}
							highlightedCatId={highlightedCatId}
						/>
					</table>
				</div>
				<div
					className="table-resize-handle"
					ref={resizeHandleRef}
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize table height"
					onPointerDown={handleResizeStart}
				/>
			</section>
		</>
	);
}
