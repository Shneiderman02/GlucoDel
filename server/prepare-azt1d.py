"""Prepare a September 2026 replay from the official CC BY 4.0 AZT1D release."""
import argparse
import csv
import io
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile

# Storage location returned by the publisher's release-1 file download URL.
DOWNLOAD = ('https://prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com/'
            '2ddc3a78-1588-4709-aacf-34b4e1b2f733')
MEMBER = 'AZT1D 2025/CGM Records/Subject 19/Subject 19.csv'
ARCHIVE_BYTES = 776131685
CGM_SOURCE = 'AZT1D · Dexcom G6 Pro'
PUMP_SOURCE = 'AZT1D · Tandem t:slim X2'
SOURCE_FROM = '2024-02-01'
SOURCE_UNTIL = '2024-03-03'
REPLAY_FROM = '2026-09-01'
REPLAY_TO = '2026-10-01'
SHIFT = datetime.fromisoformat(REPLAY_FROM) - datetime.fromisoformat(SOURCE_FROM)


class RemoteZip(io.RawIOBase):
    """Fetch only the requested parts of the pinned release archive."""

    def __init__(self):
        self.position = 0

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = (0, self.position, ARCHIVE_BYTES)[whence] + offset
        if self.position < 0:
            raise OSError('Negative ZIP offset')
        return self.position

    def seekable(self):
        return True

    def read(self, size=-1):
        remaining = ARCHIVE_BYTES - self.position
        size = min(remaining, remaining if size < 0 else size)
        if size <= 0:
            return b''
        bounds = f'{self.position}-{self.position + size - 1}'
        request = Request(DOWNLOAD, headers={'Range': f'bytes={bounds}'})
        with urlopen(request, timeout=25) as reply:
            if reply.status != 206 or reply.headers['Content-Range'] != f'bytes {bounds}/{ARCHIVE_BYTES}':
                raise ValueError('The download did not return the requested range')
            data = reply.read(size + 1)
        if len(data) != size:
            raise ValueError('Incomplete ZIP range')
        self.position += size
        return data


def positive(value):
    result = float(value) if value else 0
    if not math.isfinite(result) or result < 0:
        raise ValueError('Invalid source value')
    return result


def convert(rows):
    points, insulin, meals = {}, [], []
    seen_events = set()
    featured = None
    for row in rows:
        wall_time = row['EventDateTime']
        if not SOURCE_FROM <= wall_time < SOURCE_UNTIL:
            continue
        # The source has no zone. Encode the wall clock for GlucoDel's fixed
        # formatter; this is not an assertion that the data was recorded in MSK.
        parsed = (datetime.fromisoformat(wall_time) + SHIFT).replace(tzinfo=timezone(timedelta(hours=3)))
        at = int(parsed.timestamp() * 1000)
        glucose = positive(row['CGM'])
        if glucose:
            point = dict(id=f'azt-cgm-{at}', at=at, received=None, value=glucose / 18.0156, source=CGM_SOURCE)
            if at in points and points[at] != point:
                point['value'] = None
            points[at] = point
        bolus = positive(row['TotalBolusInsulinDelivered'])
        carbs = positive(row['CarbSize'])
        kind = row['BolusType']
        event = (at, bolus, carbs, kind)
        if event in seen_events:
            continue
        seen_events.add(event)
        key = f'{at}-{len(seen_events)}'
        if carbs:
            meal = dict(id=f'azt-meal-{key}', at=at, title=f'Запись на {carbs:g} г углеводов', products=[], loggedCarbs=carbs)
            meals.append(meal)
            if wall_time == '2024-02-03 13:25:14':
                featured = meal['id']
        if bolus:
            title = ('Автоматический болюс' if 'Automatic' in kind else
                     'Продлённый болюс' if 'Extended' in kind else
                     'Болюс с коррекцией' if 'Correction' in kind else 'Болюс')
            insulin.append(dict(id=f'azt-bolus-{key}', at=at, title=title, type='bolus',
                                actual=bolus, status='given', mode='Не указан', source=PUMP_SOURCE))
    if not points or not insulin or not featured:
        raise ValueError('Expected AZT1D sample is missing')
    return dict(dataset='study', version=0, featuredMealId=featured, replayPeriod={'from': REPLAY_FROM, 'to': REPLAY_TO},
                state=dict(meals=sorted(meals, key=lambda m: m['at']), revisions={}, scenario='full', connection='connected'),
                observations=dict(points=sorted(points.values(), key=lambda p: p['at']),
                                  insulin=sorted(insulin, key=lambda d: d['at']), context=[]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, help='Use Subject 19.csv from release 1 if already downloaded')
    options = parser.parse_args()
    if options.csv:
        data = options.csv.read_text(encoding='utf-8-sig')
    else:
        with ZipFile(RemoteZip()) as archive:
            data = archive.read(MEMBER).decode('utf-8-sig')
    workspace = convert(csv.DictReader(io.StringIO(data)))
    output = Path(__file__).resolve().parent.parent / '.glucodel' / 'azt1d.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(workspace, ensure_ascii=False), encoding='utf-8')
    valid_points = sum(point['value'] is not None for point in workspace['observations']['points'])
    print(f"Prepared {valid_points} CGM readings, "
          f"{len(workspace['observations']['insulin'])} boluses, {len(workspace['state']['meals'])} carb entries")


if __name__ == '__main__':
    main()
