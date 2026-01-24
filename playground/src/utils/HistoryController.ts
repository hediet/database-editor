import { observableValue, IReader } from "@vscode/observables";

export interface ILocation {
	hashValue: string | undefined;
	searchParams: Record<string, string | undefined>;
}

function getCurrentLocation(): ILocation {
	const hashValue = window.location.hash.substring(1) || undefined;
	const searchParams: Record<string, string | undefined> = {};
	for (const [key, value] of new URLSearchParams(window.location.search)) {
		searchParams[key] = value;
	}
	return { hashValue, searchParams };
}

const _location = observableValue<ILocation>("location", getCurrentLocation());

function updateLocation(): void {
	const newLocation = getCurrentLocation();
	const current = _location.get();
	if (JSON.stringify(newLocation) !== JSON.stringify(current)) {
		_location.set(newLocation, undefined);
	}
}

window.addEventListener("popstate", updateLocation);
window.addEventListener("hashchange", updateLocation);

export function getLocation(reader: IReader): ILocation {
	return _location.read(reader);
}

export function getLocationValue(): ILocation {
	return _location.get();
}

export function setLocation(location: ILocation, mode: 'push' | 'replace' = 'replace'): void {
	const url = new URL(window.location.href);
	url.hash = location.hashValue ? "#" + location.hashValue : "";

	const searchParams = Object.entries(location.searchParams).reduce(
		(acc, [key, value]) => {
			if (value !== undefined) {
				acc[key] = value;
			}
			return acc;
		},
		{} as Record<string, string>
	);
	url.search = new URLSearchParams(searchParams).toString();

	if (mode === 'push') {
		window.history.pushState(undefined, '', url.toString());
	} else {
		window.history.replaceState(undefined, '', url.toString());
	}

	// Update the observable
	_location.set(location, undefined);
}
