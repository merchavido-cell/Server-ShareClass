//program: name ido merchav
//import the scanner:
import java.util.Scanner;

public class homework2{

public static void main(String[] args) {
    

    System.out.println("my best animal is lion");
    System.out.println("im am ido merchav\nand i live in ra'anana\nwrite single dight number");

    Scanner input=new Scanner(System.in);


//after we open the scanner:
    int FirstUserNumber=input.nextInt();
    System.out.println("your number-1 is:" + (FirstUserNumber-1));
    System.out.println("your number is:" + (FirstUserNumber));
    System.out.println("your number+1 is:" + (FirstUserNumber+1));



    //excersize 4:

    System.out.println("write number with 3 dights:");
    int SecondUserNumber = input.nextInt();
    int summing = (SecondUserNumber%10)+((SecondUserNumber/10)%10)+(SecondUserNumber/100);
    System.out.println("the sum is " + summing);


    //excersize 5:


    System.out.println("how old are you?");
    int BornNextNumber =  input.nextInt();
    int daysLive=BornNextNumber*365;
    int hoursLive = daysLive*24;
    System.out.println("you living at days: "+ daysLive + "and at hours you liveing: "+ hoursLive);

    //excrsize 6:

    System.out.println("how much hours at the day you work?");
    int WorkHoursAtDay=input.nextInt();

    System.out.println("how much hours at the night you work?");
    double WorkHoursAtNight=input.nextInt();


    //result of excersize 6:

    System.out.println("you need to get "+(WorkHoursAtDay*18) + "and for the night: "+ ((WorkHoursAtNight*27.5)));



    //excersize 7:
    System.out.println("what is your score at math?");
    int ScoreAtMath=input.nextInt();
    System.out.println("what is your score at english?");
    int ScoreAtEnglish=input.nextInt();
    System.out.println("what is your score at science?");
    int ScoreAtScience=input.nextInt();
    System.out.println("what is your score at sport?");
    int ScoreAtSPort=input.nextInt();
    int Averange = (ScoreAtMath+ScoreAtEnglish+ScoreAtScience+ScoreAtSPort)/4;
    System.out.println("the averange is: "+Averange);



    //excresize 8:
    System.out.println("write two numbers");
    int a=input.nextInt();
    int b=input.nextInt();
    int c;
    c=a;
    a=b;
    b=c;
    System.out.println("a: " + a + " b: "+b);



//end of the programm



input.close();
}}