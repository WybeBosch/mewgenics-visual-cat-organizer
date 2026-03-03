import { STAT_ICONS, STATS, OTHER_INFO_ICONS } from '../../../../shared/config/config.jsx';
import { getCatId } from '../../../../shared/utils/catDataUtils.jsx';

export function TableCatDataLogic({ cats }) {
	// Derived columns for table header
	const columns = [
		{ key: 'name', label: 'Name', tooltip: 'Cat name' },
		{
			key: 'partner-room',
			label: '💞',
			isStatic: true,
			tooltip:
				'Matching partner in another room. Shows when this cat and another cat love each other, but they are currently in different rooms. A detective icon appears in this column for those separated matching partners.',
		},
		{ key: 'age', label: 'Age', tooltip: 'Cat age in days' },
		{ key: 'sex', label: 'Sex', tooltip: 'Sex (male, female, or herm)' },
		{ key: 'icon', label: '🔷', tooltip: 'Cat icon badge' },
		...STATS.map((s) => ({
			key: s,
			label: `${STAT_ICONS[s]} ${s}`,
			isStat: true,
			tooltip: `${s} stat`,
		})),
		{ key: 'total', label: 'Total', tooltip: 'Total of all core stats' },
		{
			key: 'libido',
			label: OTHER_INFO_ICONS.libido,
			tooltip: 'Libido',
		},
		{
			key: 'aggression',
			label: OTHER_INFO_ICONS.aggression,
			tooltip: 'Aggression',
		},
		{ key: 'loves', label: OTHER_INFO_ICONS.loves, tooltip: 'Cats they love' },
		{ key: 'hates', label: OTHER_INFO_ICONS.hates, tooltip: 'Cats they hate' },
		{ key: 'spacer', label: '', isStatic: true },
	];

	// Helper to get partnerInOtherRoom (must be mutual love)
	function isPartnerInOtherRoom(cat) {
		if (!cat.loves) return false;
		const catId = getCatId(cat);
		const partner = cats.find((c) => c.name === cat.loves || getCatId(c) === cat.loves);
		if (!partner || !partner.room || !cat.room || partner.room === cat.room) return false;
		// Only flag if love is mutual
		return partner.loves === cat.name || partner.loves === catId;
	}

	// Helper to get row background
	function getRowBg(isHovered, index) {
		if (isHovered) return 'var(--color-bg-strong)';
		return index % 2 === 0 ? 'var(--color-bg-page)' : 'var(--color-bg-muted-alt)';
	}

	// Helper to get age color and font size
	function getAgeStyle(age) {
		if (age === null) return { color: 'var(--color-text-subtle)', fontSize: '1em' };
		if (age <= 1) return { color: 'var(--color-age-kitten)', fontSize: '0.95em' };
		return { color: 'var(--color-age-adult)', fontSize: '1em' };
	}

	// Helper to get stat style
	function getStatStyle(val) {
		if (val >= 7)
			return { fontWeight: 800, color: 'var(--color-positive)', fontSize: '1.05em' };
		return { fontWeight: 400, color: 'var(--color-text-neutral)', fontSize: '1em' };
	}

	// Helper to get cell style for info columns
	function getInfoStyle(color) {
		return {
			padding: '10px 12px',
			textAlign: 'center',
			fontSize: 12,
			color,
			whiteSpace: 'nowrap',
		};
	}

	return {
		columns,
		isPartnerInOtherRoom,
		getRowBg,
		getAgeStyle,
		getStatStyle,
		getInfoStyle,
	};
}
