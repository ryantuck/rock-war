import json
import sys

from tabulate import tabulate

if __name__ == '__main__':

    turns = 0

    for line in sys.stdin:

        print(f'Board: {turns}')
        board = json.loads(line)

        str_grid = [
            [
                ''.join(str(c) for c in col) if col else None
                for col in row
            ]
            for row in board['grid']
        ]

        print(tabulate(str_grid))

        turns += 1
        print('\n\n')
                
