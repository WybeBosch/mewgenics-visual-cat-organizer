import { APP_EMOJIS } from '../../../../shared/config/config.ts';
import { getCatSex, isKitten } from '../../../../shared/utils/catDataUtils.ts';
import type { HeadingProps } from './Heading.types.ts';
import './Heading.css';

export function Heading({ cats, rooms, dataTimeLineText }: HeadingProps) {
	const headingEmoji = import.meta.env.DEV ? APP_EMOJIS.local : APP_EMOJIS.default;

	const maleCount = cats.filter((cat) => getCatSex(cat) === 'male').length;
	const femaleCount = cats.filter((cat) => getCatSex(cat) === 'female').length;
	const hermCount = cats.filter((cat) => getCatSex(cat) === 'herm').length;
	const kittenCount = cats.filter((cat) => isKitten(cat)).length;

	return (
		<div className="heading">
			<h1 className="title">{headingEmoji} Mewgenics - Visual cat organizer</h1>
			<p className="meta-text">{dataTimeLineText}</p>
			<div className="meta-text">
				<span>
					[{rooms.length} rooms, {cats.length} cats],
				</span>
				<span>
					[{maleCount} male, {femaleCount} female, {hermCount} herm],
				</span>
				<span>[{kittenCount} kittens]</span>
			</div>
		</div>
	);
}
