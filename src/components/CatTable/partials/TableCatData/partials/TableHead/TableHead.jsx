import { useState } from 'react';
import { joinClass } from '../../../../../../shared/utils/utils.jsx';
import './TableHead.css';

export function TableHead({
	columns,
	handleSort,
	sortCol,
	sortAsc,
	searchQuery,
	onSearchChange,
	onSearchSubmit,
	statFilters,
	setStatFilter,
}) {
	const [hoveredColumn, setHoveredColumn] = useState(null);

	return (
		<thead>
			<tr className="table-head">
				{columns.map((col, index) => {
					const isLeftAlignedTooltip = index < 2;
					const isRightAlignedTooltip = index === columns.length - 1;
					const isSortable = !col.isStatic;
					const isSorted = sortCol === col.key;
					const textAlignClass = col.key === 'name' ? 'left' : '';
					const staticClass = isSortable ? '' : 'static';
					const sortedClass = isSorted ? 'sorted' : '';
					const tooltipAlignClass = isLeftAlignedTooltip
						? 'left'
						: isRightAlignedTooltip
							? 'right'
							: '';
					const tooltipWidthClass = col.key === 'partner-room' ? 'wide' : '';
					const columnClass = `col-${col.key}`;
					const statClass = col.isStat ? 'col-stat' : '';
					const hasFilter = col.isStat && statFilters[col.key] != null;
					const hasFilterClass = hasFilter ? 'has-filter' : '';

					return (
						<th
							key={col.key}
							className={joinClass(
								'cell',
								columnClass,
								statClass,
								textAlignClass,
								staticClass,
								sortedClass,
								hasFilterClass
							)}
							onMouseEnter={() => setHoveredColumn(col.key)}
							onMouseLeave={() => setHoveredColumn(null)}
							onClick={isSortable ? () => handleSort(col.key) : undefined}
						>
							{hasFilter && (
								<span
									className="filter-clear"
									onClick={(e) => {
										e.stopPropagation();
										setStatFilter(col.key, null);
									}}
								>
									×
								</span>
							)}
							{col.key === 'name' ? (
								<input
									type="text"
									className="search-input"
									placeholder="Search name..."
									value={searchQuery}
									onChange={(e) => onSearchChange(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') onSearchSubmit(searchQuery);
									}}
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								col.label
							)}
							{isSorted && (
								<span className="sort-indicator">{sortAsc ? '▲' : '▼'}</span>
							)}
							{hoveredColumn === col.key && col.isStat && (
								<div
									className={joinClass(
										'tooltip',
										'stat-filter',
										tooltipAlignClass
									)}
								>
									<input
										type="text"
										className="filter-input"
										placeholder="1-9"
										maxLength={1}
										value={statFilters[col.key] ?? ''}
										onChange={(e) => {
											const v = e.target.value;
											if (v === '') {
												setStatFilter(col.key, null);
											} else if (/^[1-9]$/.test(v)) {
												setStatFilter(col.key, Number(v));
											}
										}}
										onClick={(e) => e.stopPropagation()}
									/>
								</div>
							)}
							{hoveredColumn === col.key &&
								!col.isStat &&
								col.key !== 'name' &&
								col.tooltip && (
									<div
										className={joinClass(
											'tooltip',
											tooltipAlignClass,
											tooltipWidthClass
										)}
									>
										{col.tooltip}
									</div>
								)}
						</th>
					);
				})}
			</tr>
		</thead>
	);
}
