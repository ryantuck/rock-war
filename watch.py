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

        

        captured = board['captured']
        cap_a, cap_b = '--'
        if captured['a'] != []:
            cap_a = ''.join(str(pc) for pc in captured['a'])
        if captured['b'] != []:
            cap_b = ''.join(str(pc) for pc in captured['b'])
        print(f'a : {cap_a} | b: {cap_b}')

        print(tabulate(str_grid))

        turns += 1
        print('\n\n')
                
