import json
import sys

if __name__ == '__main__':
    turns = 0
    for line in sys.stdin:
        print(f'Board: {turns}')
        board = json.loads(line)
        for row in board['grid']:
            col_str = ''
            for col in row:
                col_str += ' '
                if col:
                    col_str += ''.join((str(c) for c in col))
                else:
                    col_str += '---'
                col_str += ' '
            print(col_str)

        turns += 1
        print('\n\n')


                
