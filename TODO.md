TODO:

- move more logic from the svg inside chunk functions
- make the "hover over something" and it highlighting in the graph and the table work again
- implement typescript
- add global css variables for fontsize and fontweight
- start scaling headings to be smaller on smaller screens
- take care of the issue with the button bar that now falls outside the screen on small devices causing overflow issues.

- also trigger the table clamp if a user resizes the window (e.g. they move their browser to another screen. Reallly be careful with this to resize tracking is very expensive i believe unless react has something cheap for it we might have to throttle this or something)

- parent lines in the relationship graph, sometimes wayy to the side of the node they are supposed to connect to.. AH it snot just parent lines, its all lines. it seems that if there are to many lines coming out of a unit, things go wrong?. Rozi and Milka

- also start scraping the Actual stats not just the base stats and add checkmark somewhere in the table to toggle between em.

- have some logic to easily identify strays in the house

    -make a demo mode that moves the moves lol

- add support for mutations showing (Can use .json we save of the guy on mod site that had a json or python file with all mutations)

- try and use custom hooks more stuff like const { age, isKitten } = useCatAge(cat);

check either
https://feature-sliced.design/
or atomic
https://atomicdesign.bradfrost.com/
(brave-dashboard also uses this)
